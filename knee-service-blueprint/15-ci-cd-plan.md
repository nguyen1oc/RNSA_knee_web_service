# 15 — CI trước, CD sau

> **Cập nhật gần nhất:** 2026-10-08
> **Thay đổi gần nhất:** Thêm lộ trình deploy staging v0 lên Compute Engine VM bằng Compose; chưa bật tự deploy và chưa dùng GPU.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Mục tiêu hiện tại

`dev` nhận feature đã review và chạy CI ở mỗi lần push. `main` là source branch để deploy sau review/merge từ dev. Bước cloud đầu là deploy thủ công một commit đã review lên VM staging; chưa tự động deploy cho tới khi access, backup, rollback và cách phát hành image được chốt.

## Pipeline CI hiện tại

Workflow: `.github/workflows/ci.yml`

Quy ước commit, branch và push nằm ở [CONTRIBUTING.md](../CONTRIBUTING.md).

```text
push dev / main; pull request vào dev / main
        │
        ├── Backend: install → Ruff → Mypy → pytest → compileall
        ├── Frontend: npm ci → Vite production build
        └── Docker: build production image
                    │
                    └── tất cả pass thì mới merge
```

Các bước này không cần DICOM sample, GPU, Triton, GCP hoặc secrets. Runtime data, SQLite và DICOM vẫn nằm ngoài Git.

## Deploy đầu: staging VM thủ công

Staging v0 dùng một Compute Engine VM + Docker Compose vì app hiện tại lưu SQLite và DICOM trong local volume. Deploy một commit đã review, không deploy working tree. Giữ VM không public; truy cập qua IAP tunnel. Checklist và constraints ở [09 — GCP runbook](09-gcp-runbook.md).

Khi staging ổn định, bước tiếp theo là build image theo commit SHA, đẩy Artifact Registry và cập nhật VM bằng image bất biến. Sau đó mới cân nhắc GitHub Actions → GCP bằng Workload Identity Federation. Không lưu service-account JSON key trong GitHub secrets nếu có thể dùng OIDC/WIF.

## Vì sao chưa bật autodeploy production

CI trả lời: “commit này có build được và không phá các check cơ bản không?”. CD trả lời: “đẩy artifact này vào môi trường nào và có rollback được không?”. Với service hiện tại, trước khi bật CD cần có:

1. registry để lưu image theo commit SHA;
2. staging service và volume/storage tách khỏi local;
3. `/api/health` hoặc readiness check sau deploy;
4. migration/seed strategy không làm mất study;
5. log, retention, rollback image và người chịu trách nhiệm approve production;
6. secret management; không đưa DICOM, credential hoặc checkpoint vào image.

## Lộ trình mở rộng

| Giai đoạn | Thêm vào pipeline | Điều kiện qua |
|---|---|---|
| Mỗi push/PR | Ruff, Mypy, pytest, compile, frontend build, Docker build | Green checks trên `dev`/PR |
| Integration | Merge reviewed PR vào `dev`; smoke test example study | Green checks, native stack loads, ineligible MPR gives reason |
| Staging đầu | Deploy thủ công commit đã review lên VM; verify upload/view/delete/restart qua IAP | Private access, persistent disk, backup/restore và smoke test |
| Staging tự động | Build image SHA → Artifact Registry → update VM after merge to `dev` | Health check, rollback image, secretless WIF auth |
| Main/deploy | PR `dev → main`; manual approval rồi deploy immutable SHA | Health/readiness, smoke test và rollback |
| Production | Manual approval hoặc tag release, deploy immutable SHA, rollback | Có release note và rollback plan |
| Phase AI | Preprocess parity/model contract/Triton readiness/evaluation gate | Không dùng CI viewer để kết luận model lâm sàng |

Ruff/Mypy là static checks; pytest còn kiểm tra API và hình học. Bật autodeploy trên `main` khi registry, target runtime, secrets, health check và rollback sẵn sàng.
