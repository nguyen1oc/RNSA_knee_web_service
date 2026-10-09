# 08 — QA và bàn giao local Docker

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Thêm acceptance cho anonymous session, data isolation, expiry và upload caps.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

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
| L18 | Vào app | Không đăng ký/đăng nhập; server tạo temporary HttpOnly cookie; chỉ web publish localhost | Người 1+2 |
| L19 | Hai browser profiles | Session B không list/read/delete study upload của A; shared example vẫn xem được | Người 1 |
| L20 | Clear/expiry | Clear session xóa study/files ngay; idle/absolute expiry từ chối truy cập và cleanup khi có request/startup kế tiếp | Người 1 |
| L21 | Upload caps | Vượt request/expanded/session/file/count cap trả 413, không để dữ liệu dở trong catalog; ZIP hợp lệ trong giới hạn vẫn import | Người 1 |

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

Chặn bàn giao khi: sample study/series không mở được nhưng tuyên bố READY, import/view sai study/order/geometry, mất committed data, seed nhân bản, xóa nhầm sample, MPR volume bị dựng dù geometry gate reject, hoặc upload silently fails. MPR/3D cần được QA theo gate trong doc 16; không tuyên bố sẵn sàng lâm sàng.

Report dùng [template](templates/test-report-template.md): version, máy/browser, fixture, expected/actual, lỗi còn lại và evidence. Benchmark riêng first image cold/warm, import/index, slice cached, memory và delete; cách tính xem [14 — Metrics local](14-local-metrics-and-acceptance.md); không lấy timing mock làm kết quả.

Demo: mở app không cần tài khoản → kiểm tra cookie session → mở sample → upload ZIP/DICOM → expand Study/Series → kiểm tra session isolation bằng browser profile thứ hai → Clear session → kiểm tra upload biến mất, sample còn → thử cap/file lỗi. Không có bước inference/cloud.
