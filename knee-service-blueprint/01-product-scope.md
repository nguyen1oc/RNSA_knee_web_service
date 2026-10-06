# 01 — Phạm vi local viewer

Cập nhật 05/10/2026. MVP hiện tại là **web xem study chạy local bằng Docker**, không có auth và chưa có AI/GCP. Workspace có Analyze CTA dạng placeholder, không có AI result. [Workflow](00-user-workflow-features.md), [build steps](12-local-docker-build-steps.md).

## P0 cần hoàn thành

| Hạng mục | Acceptance |
|---|---|
| Một example study có sẵn | `series_1` và `series_2` cùng StudyInstanceUID, seed idempotent, mở được sau restart |
| Upload DICOM folder/files | Index theo UID; nhiều series/ study được group đúng |
| Upload DICOM | Nhận một/nhiều file `.dcm` hoặc folder `.dcm`; report file lỗi |
| Danh sách + sidebar series | Source kind, counts, READY/PARTIAL/FAILED; nhiều candidate giữ nguyên |
| Ingest pipeline | Validate DICOM, extract metadata, group UID, geometry-aware sort, preview on demand |
| Viewer và controls | Tabs, 4-slot viewer, Study information panel, scroll/slider, zoom/pan/reset; contrast/brightness/invert preview |
| Layout DICOM 4 ô/tab hướng | Hiện hướng có thật, thiếu hướng có message; geometry unknown có stack fallback |
| Persistence + xóa study upload | SQLite/raw data ngoài container; xóa không đụng mẫu gốc |
| Docker + README + QA | Khởi động local, backup/restore thử, code build và E2E có evidence |

P1: MPR/crosshair/locator 3D trên series đủ geometry, so hai series. P2: volume rendering nâng cao, segmentation/mesh, inference, model contract, Triton, GCP/PACS. Không dùng checkpoint/GPU quota làm blocker P0.

## Định dạng và dữ liệu

Ma trận ở [13](13-input-formats-and-example-studies.md). Input P0 là DICOM `.dcm` trong folder hoặc nhiều file. ZIP, NIfTI/TIFF/PNG/JPG/video không thuộc vertical slice hiện tại. Một folder không tương đương một study; mỗi DICOM StudyInstanceUID thành một study.

Hai series fixture hiện có thuộc cùng một study và tạo thành sample duy nhất. Thumbnail chỉ phục vụ danh sách, viewport tải ảnh DICOM đầy đủ.

## Phi chức năng

- Một catalog chung, không user table/password/token/identity bypass.
- Chỉ publish `127.0.0.1:8080` cho bản Docker local.
- Study giữ đến khi người dùng xóa; staging incomplete hết hạn sau 24h.
- Chỉ index/decode theo nhu cầu; giới hạn cache và release khi đổi study.
- Không mất committed data sau restart; import gián đoạn retry giới hạn hoặc FAILED rõ.
- Một worker, một import active; giới hạn ban đầu 500 MiB/upload, 2.000 file DICOM. Điều chỉnh theo fixture/benchmark.
- Dữ liệu mẫu phải có nguồn/quyền dùng và được rà soát thông tin nhận dạng trước khi chia sẻ demo.

## Hiệu năng và nghiệm thu

Đo upload, index, ảnh đầu tiên cold/warm và memory khi đổi study 10 lần. Mục tiêu thử cho slice đã cache: p95 ≤100 ms trên 100 lần chuyển và máy/browser ghi trong report; đây chưa là benchmark đạt.

DoD: sample study + cả hai đường nhập folder/files `.dcm` mở ảnh thật; study upload xóa được với xác nhận và không xóa sample; renderer giữ đúng order/series; cây study/series và Analyze placeholder hoạt động; không lỗi dữ liệu sau refresh/recreate; có [report QA](08-qa-release.md). QA phần mềm không xác nhận hiệu quả chẩn đoán.
