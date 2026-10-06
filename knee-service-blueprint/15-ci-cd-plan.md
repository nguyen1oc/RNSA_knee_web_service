# 15 — CI trước, CD sau

## Mục tiêu hiện tại

Local viewer chưa có test DICOM fixture đầy đủ, nên CI chỉ cần bảo đảm code có thể kiểm tra tĩnh và đóng gói được. Chưa tự deploy mỗi lần push; deploy tự động chỉ nên bật sau khi có môi trường staging và health check rõ ràng.

## Pipeline CI hiện tại

Workflow: `.github/workflows/ci.yml`

```text
push / pull request
        │
        ├── Backend: install → Ruff → Mypy → compileall
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
| Hiện tại | Ruff, Mypy, compile, frontend build, Docker build | Merge vào `main` |
| Trước staging | `pytest` API với fixture DICOM nhỏ, upload/list/delete, image response, geometry edge cases | Test pass + coverage tối thiểu do team chốt |
| Staging | Push image SHA lên registry, deploy staging, gọi health/readiness và smoke test | Staging healthy |
| Production | Manual approval hoặc tag release, deploy immutable SHA, rollback | Có release note và rollback plan |
| Phase AI | Preprocess parity/model contract/Triton readiness/evaluation gate | Không dùng CI viewer để kết luận model lâm sàng |

Hiện tại `mypy` và Ruff là static checks, không thay thế test hành vi. Khi có fixture DICOM ổn định, ưu tiên thêm pytest trước khi nối autodeploy.
