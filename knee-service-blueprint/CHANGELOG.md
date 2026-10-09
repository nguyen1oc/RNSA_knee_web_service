# Changelog — Knee Review

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Capture presets changed to square 64/128/512; 512×512 remains the default.

## 2026-10-09 — Smaller capture size presets

- Changed the square PNG/JPEG export options to `64×64`, `128×128`, and `512×512`, with `512×512` selected by default.
- Kept the capture preview square and centered in narrow layouts; compacted metadata for 64/128px exports so it does not overwhelm the image.
- Updated the README, viewer/design specifications, acceptance checklist, native DICOM notes, and HTML design board. The previous 256/512/1024 presets are retained below as historical change log entries.

## 2026-10-09 — Previous capture preview and export sizes

- Restored a live preview inside the capture dialog; it regenerates from the rendered viewport when format, size, annotation or metadata options change.
- Added exact square output presets `256×256`, `512×512`, and `1024×1024`; keep W/L, pan, zoom and optional annotations in the export. Metadata is included within the selected square canvas.
- Updated viewer specs, local acceptance checks, README and HTML design board.

## 2026-10-09 — Fix post-delete refresh selection

## 2026-10-09 — Fix post-delete refresh selection

- Refresh no longer falls back to the deleted active study ID after its DELETE succeeds.
- Select the first remaining study, or show the empty workspace if none remain; deleting a non-active study continues to preserve the current selection.
- Documented the selection behavior in the UI workflow/design notes.

## 2026-10-09 — In-app confirmation popups

## 2026-10-09 — Replace browser confirmation dialogs

- Replaced native `window.confirm` prompts—which showed browser text such as “localhost says”—with an accessible, branded confirmation modal for Delete study and Clear session.
- The modal explains which local files are removed, offers Cancel and an explicit destructive action, and prevents duplicate submission while work is in progress.
- Updated the design-system guidance and HTML design board.

## 2026-10-09 — Separate study header actions

## 2026-10-09 — Study action spacing

- Added a consistent gap and no-wrap behavior for Analyze and Delete study so the actions remain visually distinct at narrow and desktop widths.
- Updated the design-system note and HTML design board to match the live study header.

## 2026-10-09 — Overview MRI Volume + linked MPR restored

- The active dev-based branch did not include the earlier MRI Volume viewer feature, so Overview showed the old orientation locator and the MPR/volume UI appeared missing.
- Restored native 3D MRI Volume, colored MPR slice overlays, slice-plane drag, independent volume zoom, and three-ring orientation gizmo into Overview. The source selector identifies the single series feeding the volume; direction tabs continue to show original acquisitions.
- Removed the separate MPR tab; Overview is now the MPR workspace. Ingest notices align within the workspace content column instead of spanning the study sidebar.
- Updated product, viewer, workflow, QA and HTML design-board docs. This is voxel-intensity visualization, not anatomy segmentation and not clinically validated.

## 2026-10-09 — Anonymous temporary workspace (current)

- Replaced account login with an unguessable, HttpOnly browser-session cookie; every study/series/DICOM/image route checks the session owner. The shared example stays read-only.
- Added Clear session deletion, 60-minute idle / 4-hour absolute expiry and cleanup on startup/next request.
- Stream ZIP/DICOM members to staging disk; enforce 600 MiB request, 800 MiB expanded/session, 200 MiB per DICOM, and 500-file defaults. These accommodate current `results.zip` with headroom.
- Added session-isolation/reset/expiry tests and upload-cap tests. Split page session handling, session controls, server session tokens and upload staging into small modules.
- Public Cloud Run still requires GCS temp objects, shared session metadata, HTTPS, ingress rate limiting and cleanup; current VM staging remains private via IAP.
- CI does not deploy automatically; keep feature PR → `dev` staging test → reviewed `main` production.

## 2026-10-09 — Earlier account-auth prototype (superseded before release)

- Briefly implemented Firebase email/password and UID-scoped ownership while considering persistent per-account study storage.
- Product direction changed to no accounts and temporary uploads; Firebase login code and its docs were removed. No cloud account or data migration was made.

> **Cập nhật gần nhất:** 2026-10-07
> **Thay đổi gần nhất:** Chốt feature branch → PR vào dev; merge dev vào main chỉ khi deploy.
> **Quy ước:** Mỗi entry ghi ngày, commit hoặc nguồn, nhóm thay đổi và tác động. Các kế hoạch cũ không bị xóa; chúng được đánh dấu historical/deferred trong tài liệu liên quan.

## 2026-10-07 — Branch strategy and MPR interaction

- `dev` là nhánh tích hợp và chạy CI mỗi lần push; `main` là nhánh deploy sau khi review/merge. CI cũng chạy cho Pull Request.
- Feature mới bắt đầu từ `dev`, được push trên branch riêng và review qua PR vào `dev`; chỉ đưa `dev` vào `main` khi deploy.
- Cho phép drag reference line để nhảy giao điểm crosshair trên MPR; click line / crosshair liên kết ba mặt phẳng.

## 2026-10-06 — Current

### P1 — Native DICOM và single-series MPR

- Thay PNG/CSS trong reading view bằng Cornerstone3D 5.11.5; giữ PNG cho inventory thumbnails. W/L thật, native tool geometry, fit-minimum zoom, per-cell slice/camera, inline arrow notes, eraser và viewport capture.
- Thêm tab MPR: một acquisition → ba orthographic views + linked crosshair. Backend từ chối thiếu/không đều geometry, duplicate position, mixed frames/dimensions/pixel formats và volume vượt budget; không ghép acquisition khác nhau.
- Thêm endpoint raw DICOM byte-exact và volume eligibility; 24 pytest cases tổng cộng cùng Ruff/Mypy.
- Tách runtime, volume preload, capture, orientation labels, tool/layout pickers thành module nhỏ. Series selection giữ acquisition đang chọn khi có nhiều series cùng hướng.
- Docker và frontend CI dùng Node 24; lockfile gồm peer dependencies để npm ci chạy sạch.
- Cập nhật README, API spec, viewer spec, CI plan và design-board.html; thêm [16 — Native DICOM/MPR](16-native-dicom-and-mpr.md).
- Giới hạn: chưa patient-specific 3D, persisted annotations, DICOM SR hay clinical validation; transitive npm advisories cần xử lý trước public deployment. Mục P0 bên dưới là lịch sử, không còn mô tả renderer hiện tại.

### Added

- `.github/workflows/ci.yml`: backend Ruff/Mypy/compile, frontend build và Docker image build.
- `knee-web/requirements-dev.txt` và `knee-web/pyproject.toml` cho dev checks.
- [CONTRIBUTING.md](../CONTRIBUTING.md) với branch strategy, Conventional Commits, cách push và lộ trình CD.
- [15 — CI/CD plan](15-ci-cd-plan.md).

### Fixed

- `knee-web/requirements-dev.txt` dùng `-r backend/requirements.txt`, khớp với vị trí thật của production dependencies khi workflow chạy trong `knee-web`.
- Thêm `knee-web/tests/test_api.py` với 6 backend contract tests; CI chạy pytest cho ZIP upload, seed idempotency, read-only example và cleanup study upload.

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
