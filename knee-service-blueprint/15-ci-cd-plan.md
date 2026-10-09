# 15 — CI trước, CD sau

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Phân biệt `dev` → staging/review với `main` → production; ghi rõ staging hiện tại là VM riêng tư qua IAP, chưa có URL public.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Mục tiêu hiện tại

`dev` là nhánh tích hợp và là nguồn deploy **staging/review**. `main` chỉ nhận PR từ `dev` sau khi review; đây là nguồn deploy **production**. Feature branch không deploy production. Hiện dự án mới có staging v0 trên VM riêng tư; **chưa có production deployment và chưa có URL public cho người dùng**. “Deploy lên `dev`” nghĩa là deploy artifact được build từ commit trên `dev`, không có nghĩa chạy Git branch trực tiếp như một service.

Luồng chuẩn:

```text
feature/* → PR → dev → staging/review
                    ↓ review + approval
                  PR dev → main → production
```

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

Staging v0 hiện dùng một Compute Engine VM + Docker Compose vì app lưu SQLite và DICOM trong local volume. VM không public; chỉ người được cấp IAM truy cập qua IAP tunnel. Đây là staging nội bộ để nhóm kiểm tra, **không phải URL cho người dùng bên ngoài**. Chi tiết trạng thái ở [09 — GCP runbook](09-gcp-runbook.md).

Đích staging/review có URL public: Firebase Hosting cho React và Cloud Run cho FastAPI, tách deploy theo artifact nhưng có thể route `/api/**` qua Hosting. Account `admin123` dự kiến được upload/delete study thuộc chính account; mỗi reviewer cần Identity UID riêng để study cách ly. Nếu tất cả dùng chung credential `admin123 / 123456`, tất cả là cùng một account và cùng thấy study của account đó. Trước khi public URL, backend phải enforce ownership và storage phải bền vững; không mở bản hiện tại nguyên trạng ra Internet vì chưa có login/ownership.

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
| Staging hiện tại | Deploy commit `dev` lên VM; kiểm tra qua IAP tunnel | Chỉ nhóm được cấp IAM; không phải public URL |
| Staging có URL | Deploy React lên Firebase Hosting + FastAPI lên Cloud Run từ `dev`; account riêng được upload/delete study của mình | Auth, owner isolation, example read-only, upload/view/delete test và rollback đã kiểm tra |
| Main/production | PR `dev → main`; manual approval rồi deploy immutable SHA cho cả frontend/backend | HTTPS/domain, auth, backup, health/readiness, smoke test và rollback |
| Production | Manual approval hoặc tag release, deploy immutable SHA, rollback | Có release note và rollback plan |
| Phase AI | Preprocess parity/model contract/Triton readiness/evaluation gate | Không dùng CI viewer để kết luận model lâm sàng |

Ruff/Mypy là static checks; pytest còn kiểm tra API và hình học. Bật autodeploy trên `main` khi registry, target runtime, secrets, health check và rollback sẵn sàng.
