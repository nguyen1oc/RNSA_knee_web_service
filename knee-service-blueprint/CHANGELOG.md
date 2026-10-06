# Changelog — Knee Review

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Dùng slider sát mép phải kiểu scrollbar browser có trạng thái loading, khóa body scroll khi thao tác viewport, tool picker có icon và cải thiện font số đo.
> **Quy ước:** Mỗi entry ghi ngày, commit hoặc nguồn, nhóm thay đổi và tác động. Các kế hoạch cũ không bị xóa; chúng được đánh dấu historical/deferred trong tài liệu liên quan.

## 2026-10-06 — Current

### Added

- `.github/workflows/ci.yml`: backend Ruff/Mypy/compile, frontend build và Docker image build.
- `knee-web/requirements-dev.txt` và `knee-web/pyproject.toml` cho dev checks.
- [CONTRIBUTING.md](../CONTRIBUTING.md) với branch strategy, Conventional Commits, cách push và lộ trình CD.
- [15 — CI/CD plan](15-ci-cd-plan.md).

### Fixed

- `knee-web/requirements-dev.txt` dùng `-r backend/requirements.txt`, khớp với vị trí thật của production dependencies khi workflow chạy trong `knee-web`.

### Viewer update

- Upload nhận thêm `.zip` không mã hóa; backend đọc các member `.dcm` hợp lệ và không cho phép path traversal.
- `results.zip` trong thư mục examples được seed thành example read-only khi Compose khởi động; member được flatten tên file để tránh Windows MAX_PATH.
- Overview có rail slice riêng cho từng series; wheel trên card active đổi slice và chặn scroll lan ra trang.
- Focused viewport dùng Pointer làm tool mặc định; mỗi ô có rail dọc ở bên phải để scrub slice, footer giữ tên series và chỉ số slice không che controls.
- Zoom/reset được đặt riêng trong từng viewport; zoom không nhỏ hơn fit 100%, không có max nhân tạo, và focused series mới mở từ slice 1 thay vì slice giữa.
- Direction tabs có preset layout `1x1`, `2x2` và custom grid tối đa `4x4`; mỗi viewport có slice slider/prev/next, wheel navigation và Sync slices.
- Layout controls được gom thành một dropdown; custom picker hiển thị bảng 4×4 và preview vùng khi hover trước khi click áp dụng.
- Gộp Length, Rectangle, Ellipse, Freehand và Arrow + note thành tool dropdown; Pointer là mặc định để chọn viewport, đổi slice và pan khi đã zoom.
- Length/shape hiển thị px hoặc mm/dimension khi PixelSpacing hợp lệ; Arrow + note mở inline editor thay cho browser prompt.
- Thêm `Undo mark`/`Clear slice marks`; mark được gắn theo viewport và slice hiện tại để có thể sửa thao tác nhầm.
- Overview có lựa chọn `3D four-up`, `3D primary`, `3D main`; image stage dùng nền đen để khớp MRI.
- Crosshair vẫn disabled khi study chưa mapping-ready; MPR/calibrated mm measurement/DICOM SR để phase sau.

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
