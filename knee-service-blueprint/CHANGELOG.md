# Changelog — Knee Review

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Ghi lại lịch sử build local, refactor viewer và CI baseline; thêm quy ước Conventional Commits/GitHub Flow.  
> **Quy ước:** Mỗi entry ghi ngày, commit hoặc nguồn, nhóm thay đổi và tác động. Các kế hoạch cũ không bị xóa; chúng được đánh dấu historical/deferred trong tài liệu liên quan.

## 2026-10-06 — Current

### Added

- `.github/workflows/ci.yml`: backend Ruff/Mypy/compile, frontend build và Docker image build.
- `knee-web/requirements-dev.txt` và `knee-web/pyproject.toml` cho dev checks.
- [CONTRIBUTING.md](../CONTRIBUTING.md) với branch strategy, Conventional Commits, cách push và lộ trình CD.
- [15 — CI/CD plan](15-ci-cd-plan.md).

### Changed

- `main.py`: chuẩn hóa đọc numeric DICOM value và sửa các lỗi Mypy.
- Các tài liệu chính có metadata ngày cập nhật và liên kết changelog.

### Git history

| Commit | Nội dung |
|---|---|
| `091cc23` | Add baseline CI checks |
| `1b1ffe3` | Split viewer into reusable React components |
| `7259c45` | Build local knee DICOM review service |

## 2026-10-05 — Local viewer scope

### Historical decision recorded in docs

- Chuyển trọng tâm sang local Docker viewer: upload `.dcm`, một example study, xem Study → Series → slices.
- Không auth, chưa AI/Triton/GCP trong release local.
- Analyze giữ ở dạng placeholder; patient-specific 3D/MPR để phase sau.

Nguồn chi tiết: [12 — Build steps](12-local-docker-build-steps.md), [13 — Input/examples](13-input-formats-and-example-studies.md), [11 — Team plan](11-team-rebalance-and-vibe-frontend.md).

## 2026-09-30 — Superseded planning

- Kế hoạch ban đầu có scope AI, cloud, authentication và Triton/GCP.
- Những phần này được giữ để tham khảo trong các file 06, 07 và 09 nhưng không phải release gate của local viewer hiện tại.

## Format cho entry mới

Dùng các nhóm `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`, `Security` khi phù hợp. Mỗi thay đổi code đáng kể nên liên kết commit/PR; mỗi thay đổi scope hoặc contract nên cập nhật tài liệu liên quan trong cùng PR.
