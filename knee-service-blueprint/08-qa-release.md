# 08 — QA và bàn giao local Docker

Cập nhật 05/10/2026. Mặc định mọi test là NOT_RUN; đây là acceptance plan. Người 1 own upload/storage/Docker, Người 2 own UI/viewer. Model, GCP, IAP không là release gate local.

## Bộ test bắt buộc

| ID | Case | Mong đợi | Owner |
|---|---|---|---|
| L01 | Clean boot + seed sample | Một sample study mở được cả `series_1` và `series_2`; missing source không báo READY | Người 1 |
| L02 | Seed lần hai / recreate container | Không nhân bản study; study upload vẫn còn | Người 1 |
| L03 | Folder DICOM hiện có | 1 study, 2 series, 34 + 30 files; order theo geometry nếu đủ | Người 1+2 |
| L03a | Ingest pipeline endpoint | Study payload và `/api/studies/{id}/pipeline` có validate/metadata/group/sort complete, preview on-demand | Người 1 |
| L04 | Filename DICOM đảo thứ tự | Group UID/physical sort đúng, không theo tên file | Người 1 |
| L05 | Oblique/thiếu geometry | Orientation và tỷ lệ đúng hoặc fallback ghi rõ; không MPR giả | Người 2 |
| L06 | ZIP/PNG/JPG không thuộc input hiện tại | Bị từ chối rõ ràng; không tạo study rác | Người 1 |
| L07 | File `.dcm` hỏng/unsupported | Bị chặn hoặc báo từng lỗi, không ghi ngoài staging/treo worker | Người 1 |
| L08 | Import DICOM trùng/cùng SOP khác checksum | Reuse hoặc conflict đúng; không overwrite file cũ | Người 1 |
| L09 | Retry upload/complete/job | Receipt/job idempotent; không sinh trùng do retry | Người 1 |
| L10 | Worker/API chết giữa index/commit | Recover/retry giới hạn hoặc FAILED; committed data không mất | Người 1 |
| L11 | Đổi tab/series/study 10 lần | Không ảnh cũ dưới label mới; memory không tăng vô hạn | Người 2 |
| L12 | MONOCHROME1/rescale; zoom/pan/W-L/reset | Đúng ảnh tham chiếu; W-L không đổi pixel file | Người 2 |
| L13 | Thiếu hướng/FS/fluid unknown | Viewer vẫn dùng; không coi null=false; không tạo series giả | Người 2 |
| L14 | Xóa study upload/sample | Upload xóa sau confirmation; sample read-only; đang index không xóa | Người 1+2 |
| L15 | Xóa cleanup lỗi / retry | Không xóa nhầm study khác; retry đưa tới DELETED hoặc DELETE_FAILED rõ | Người 1 |
| L16 | Backup/restore sang volume riêng | Count/checksum/ảnh mở lại đúng | Người 1 |
| L17 | UI/build Docker | Typecheck/lint/build; SPA direct URL; viewer assets tải local | Người 2 |
| L17a | Design-board parity | 1440×900 có tabs, viewer 4 ô, Study information panel và tree đúng vùng chức năng | Người 2 |
| L18 | Vào app | Không login/password/token/AI dependency; chỉ web publish localhost | Người 1+2 |

Fixture gốc: một sample study gồm hai series + các bộ lỗi nhỏ/synthetic; không cần tìm nhiều ca thật chỉ để test ZIP/parser. Existing 64-file case mới kiểm tra header, chưa ghi PASS render/de-identification. Compressed DICOM/multi-frame chỉ thêm vào supported matrix khi có bằng chứng decode + geometry.

## UI và dữ liệu

- [ ] Nền sáng theo design tokens; runtime label tiếng Anh; label trên MRI có nền tương phản.
- [ ] Active viewport rõ; keyboard dùng được nút/slider; 1280×800 và 1440×900.
- [ ] Upload progress và indexing stage riêng; loading/empty/partial/failed có hành động rõ.
- [ ] File errors/counts được liệt kê, không ngầm bỏ ảnh rồi gọi study đầy đủ.
- [ ] Samples có nguồn, checksum, thông tin khử định danh được kiểm tra trước demo chia sẻ.
- [ ] Cache/thumbnail không thay raw originals; display preview không thay DICOM; lỗi disk/codec không để job RUNNING mãi.
- [ ] Study tree expand/collapse không đổi active series ngoài thao tác chọn label.
- [ ] Analyze chỉ hiện notice chưa kết nối AI/Triton, không có score giả.

## Release gate

Chặn bàn giao P0 khi: sample study hoặc một trong hai series chưa mở được nhưng tuyên bố READY, nhập/xem format đã cam kết không được, sai study/order/geometry labels, mất committed data sau restart, seed nhân bản, xóa nhầm sample, hoặc import silently fails. P1 MPR/3D chưa có không chặn P0 và phải ghi rõ chưa triển khai.

Report dùng [template](templates/test-report-template.md): version, máy/browser, fixture, expected/actual, lỗi còn lại và evidence. Benchmark riêng first image cold/warm, import/index, slice cached, memory và delete; cách tính xem [14 — Metrics local](14-local-metrics-and-acceptance.md); không lấy timing mock làm kết quả.

Demo: mở sample study → expand Study/Series tree → chuyển `series_1`/`series_2` → upload folder DICOM → scroll/zoom/display preview → bấm Analyze → xóa study upload → refresh/restart → mở lại sample → thử một file lỗi. Không có bước inference/cloud/auth.
