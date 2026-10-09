# 15 — CI trước, CD sau

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Chốt feature → dev staging → main production; CI kiểm session isolation, TTL, upload caps. CD chưa tự động bật.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Mục tiêu hiện tại

`dev` nhận feature đã review và là nhánh staging; `main` là production. Không sửa source trực tiếp trên VM và không dùng VM để làm nơi giữ source chuẩn. Mỗi môi trường chạy image bất biến build từ commit SHA.

## Pipeline CI hiện tại

Workflow: `.github/workflows/ci.yml`

Quy ước commit, branch và push nằm ở [CONTRIBUTING.md](../CONTRIBUTING.md).

```text
feature/* → PR dev → deploy/test staging → PR dev→main → production
        │
        ├── PR/push: Backend Ruff → Mypy → pytest → compileall
        ├── PR/push: Frontend npm ci → Vite production build
        └── PR/push: Docker image build
                    └── tất cả pass thì mới merge
```

Các bước này không cần DICOM sample, GPU, Triton, GCP hoặc secrets. Runtime data, SQLite và DICOM vẫn nằm ngoài Git.

## Staging và production flow

1. Tạo branch feature từ `dev`; code và test local.
2. Mở PR feature → `dev`. GitHub Actions chạy CI; review rồi mới merge.
3. Deploy đúng commit SHA của `dev` lên staging. Hiện staging là VM riêng tư qua IAP; cập nhật repo/image trên VM, không sửa tay source đang chạy. Smoke-test hai browser sessions, upload/view/delete, clear/expiry, upload limits và sample read-only.
4. Khi staging pass, mở PR `dev` → `main`; sau review/approval mới merge.
5. Production deploy đúng SHA đã merge vào `main`; chạy health/smoke test và giữ image SHA trước đó để rollback.

Hiện workflow chỉ làm CI; bước deploy staging/production vẫn thủ công và chưa có credentials trong GitHub. Đây là chủ ý cho tới khi hoàn tất storage/database production và workload identity.

## Vì sao chưa bật autodeploy

CI trả lời: “commit này có build được và không phá các check cơ bản không?”. CD trả lời: “đẩy artifact này vào môi trường nào và có rollback được không?”. Với service hiện tại, trước khi bật CD cần có:

1. Artifact Registry để lưu image theo commit SHA;
2. staging và production tách biệt;
3. Cloud Storage cho DICOM tạm và shared session/study metadata store (Firestore hoặc Cloud SQL; SQLite/local disk không phù hợp Cloud Run instances);
4. `/api/health` readiness check, migration strategy, backups/retention;
5. GitHub Actions Workload Identity Federation + least-privilege service account; không lưu service-account JSON key;
6. log, rollback, production approval gate; không đưa DICOM, credentials hoặc checkpoint vào image.

## Lộ trình mở rộng

| Giai đoạn | Thêm vào pipeline | Điều kiện qua |
|---|---|---|
| Mỗi push/PR | Ruff, Mypy, pytest, compile, frontend build, Docker build | Green checks trên `dev`/PR |
| Integration | Merge reviewed PR vào `dev`; deploy commit SHA lên staging và smoke-test | Session isolation, reset/TTL, upload caps, sample read-only |
| Main/deploy | PR `dev → main`; deploy immutable SHA after infra is configured | Health/readiness and smoke test |
| Production | Manual approval hoặc tag release, deploy immutable SHA, rollback | Có release note và rollback plan |
| Phase AI | Preprocess parity/model contract/Triton readiness/evaluation gate | Không dùng CI viewer để kết luận model lâm sàng |

Ruff/Mypy là static checks; pytest còn kiểm tra API và hình học. Bật autodeploy trên `main` khi registry, target runtime, secrets, health check và rollback sẵn sàng.
