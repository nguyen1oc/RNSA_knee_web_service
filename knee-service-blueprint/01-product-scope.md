# 01 — Phạm vi local viewer

> **Cập nhật gần nhất:** 2026-10-13
> **Ghi chú:** Bảng P0/P1 dưới đây mô tả phạm vi phát triển ban đầu. Ứng dụng hiện đã có Analyze qua Triton; xem [21 — tài liệu bàn giao](21-project-handover.md) để biết trạng thái hiện tại.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Ứng dụng hiện có bản local và bản cloud. Người dùng không cần tài khoản; backend tạo temporary session cookie để cô lập study giữa các browser. Bản local dùng Docker, SQLite và filesystem. Bản cloud dùng Cloud Run, Firestore và Cloud Storage; Analyze gọi Triton khi môi trường được cấu hình. Người dùng đã xác nhận Analyze production hoạt động, nhưng trạng thái live cần xác minh trên Cloud Run trước mỗi lần phát hành. Tài liệu này giữ phạm vi sản phẩm ban đầu; đọc [21 — tài liệu bàn giao](21-project-handover.md) để xem luồng triển khai hiện tại.

## P0 cần hoàn thành

| Hạng mục | Acceptance |
|---|---|
| Một example study có sẵn | `series_1` và `series_2` cùng StudyInstanceUID, seed idempotent, mở được sau restart |
| Upload DICOM folder/files | Index theo UID; nhiều series/ study được group đúng |
| Upload DICOM | Nhận một/nhiều file `.dcm` hoặc folder `.dcm`; report file lỗi |
| Danh sách + sidebar series | Source kind, counts, READY/PARTIAL/FAILED; nhiều candidate giữ nguyên |
| Ingest pipeline | Validate DICOM, extract metadata, group UID, geometry-aware sort, preview on demand |
| Viewer và controls | Overview có MRI Volume + ba MPR planes đồng bộ, source/layout/Crosshair; direction tabs giữ native acquisition stack; Study information, zoom/pan/reset/W-L |
| Layout DICOM 4 ô/tab hướng | Hiện hướng có thật, thiếu hướng có message; geometry unknown có stack fallback |
| Persistence + xóa study upload | SQLite/raw data ngoài container; xóa không đụng mẫu gốc |
| Docker + README + QA | Khởi động local, backup/restore thử, code build và E2E có evidence |

Viewer hiện có MRI Volume ray-cast và MPR liên kết trên series đủ geometry. Analyze/Triton đã được nối trong các môi trường cloud theo trạng thái ở trang bàn giao. Segmentation/mesh, kết nối PACS và kiểm định lâm sàng vẫn nằm ngoài phạm vi hiện tại. Bản local có thể chạy inference riêng khi được cấp checkpoint và cấu hình phù hợp.

## Định dạng và dữ liệu

Ma trận ở [13](13-input-formats-and-example-studies.md). Input P0 là DICOM `.dcm` trong folder hoặc nhiều file. ZIP, NIfTI/TIFF/PNG/JPG/video không thuộc vertical slice hiện tại. Một folder không tương đương một study; mỗi DICOM StudyInstanceUID thành một study.

Fixture local ban đầu có hai series cùng một study. Example study trên staging đã được ghi nhận có 5 series và 284 ảnh. Các môi trường có thể dùng fixture khác nhau; hãy đọc số liệu từ API thay vì giả định số series cố định. Thumbnail chỉ phục vụ danh sách, viewport tải ảnh DICOM đầy đủ.

## Phi chức năng

- Không username/password/email/provider; backend cấp session ID ngẫu nhiên qua HttpOnly cookie và chỉ cho session đó truy cập study đã upload.
- Chỉ publish `127.0.0.1:8080` cho bản Docker local.
- Study upload tạm được xóa bằng Delete study/Clear session hoặc hết hạn sau 60 phút idle, tối đa 4 giờ. Shared example read-only.
- Chỉ index/decode theo nhu cầu; giới hạn cache và release khi đổi study.
- Không mất committed data sau restart; import gián đoạn retry giới hạn hoặc FAILED rõ.
- Upload mặc định tối đa 600 MiB/request, 800 MiB expanded/session, 200 MiB/file, 500 DICOM; stream qua disk staging. Điều chỉnh theo fixture/benchmark.
- Dữ liệu mẫu phải có nguồn/quyền dùng và được rà soát thông tin nhận dạng trước khi chia sẻ demo.

## Hiệu năng và nghiệm thu

Đo upload, index, ảnh đầu tiên cold/warm và memory khi đổi study 10 lần. Mục tiêu thử cho slice đã cache: p95 ≤100 ms trên 100 lần chuyển và máy/browser ghi trong report; đây chưa là benchmark đạt.

DoD ban đầu của viewer: sample study và các đường nhập DICOM mở ảnh thật; study upload xóa được mà không xóa sample; renderer giữ đúng thứ tự; dữ liệu không lỗi sau refresh/restart. Analyze cần được QA riêng: gọi đúng model, trả đủ 12 scores và hiển thị disclaimer. QA phần mềm không xác nhận hiệu quả chẩn đoán.
