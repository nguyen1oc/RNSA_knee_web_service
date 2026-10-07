# 15 — CI trước, CD sau

> **Cập nhật gần nhất:** 2026-10-07
> **Thay đổi gần nhất:** Quy ước main là deploy source, dev là integration branch chạy CI; checks trên push và PR.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Mục tiêu hiện tại

`dev` nhận feature đã review và chạy CI ở mỗi lần push. `main` là source branch để deploy sau review/merge từ dev. Chưa cấu hình deploy tự động vì repository chưa có registry, staging runtime và secrets.

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

## Vì sao chưa bật autodeploy

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
| Main/deploy | PR `dev → main`; deploy immutable SHA after infra is configured | Health/readiness and smoke test |
| Production | Manual approval hoặc tag release, deploy immutable SHA, rollback | Có release note và rollback plan |
| Phase AI | Preprocess parity/model contract/Triton readiness/evaluation gate | Không dùng CI viewer để kết luận model lâm sàng |

Ruff/Mypy là static checks; pytest còn kiểm tra API và hình học. Bật autodeploy trên `main` khi registry, target runtime, secrets, health check và rollback sẵn sàng.
