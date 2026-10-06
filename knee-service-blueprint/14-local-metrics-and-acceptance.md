# 14 — Metrics đánh giá local viewer

Cập nhật 05/10/2026. Các metric dưới đây đánh giá service local sau khi build; chúng không đo độ chính xác model, vì inference/Triton chưa nằm trong scope.

## 1. Bộ metric tối thiểu cần ghi

| Nhóm | Metric | Cách đo | Mục tiêu/điều kiện ban đầu |
|---|---|---|---|
| Đúng dữ liệu | Study grouping accuracy | Import sample và folder/files `.dcm`; so StudyInstanceUID/SeriesInstanceUID với manifest expected | 100%; không tách `series_1`/`series_2` thành hai study |
| Đúng dữ liệu | Slice order correctness | So thứ tự manifest với thứ tự geometry/reference; kiểm tra đầu/giữa/cuối stack | 100% trên fixture đã chốt |
| Đúng dữ liệu | Series selection correctness | Click từng series, kiểm tra label/UID/ảnh đầu tiên và ảnh cuối | 100%; không hiển thị ảnh cũ dưới label mới |
| Đúng dữ liệu | Pixel/render fidelity | So một số slice với viewer/reference; kiểm tra rows/columns, photometric, rescale, MONOCHROME1 | Không đảo sáng/tối hoặc sai shape; sai phải block release |
| Import | Import success rate | Số upload DICOM hợp lệ đạt READY / tổng upload hợp lệ | 100% trên P0 fixture |
| Import | Partial/error classification | File hỏng/unsupported/thiếu geometry | 100% có code/warning; không silent skip |
| Import | Pipeline stage completeness | Kiểm tra `validate`, `metadata`, `group`, `sort`, `preview` trong study payload/endpoint | Bốn stage đầu complete; preview on-demand; không thiếu stage |
| Import | Geometry-aware sort method | So `sort_method` và ảnh đầu/giữa/cuối với vị trí DICOM | Physical position khi đủ geometry; fallback rõ khi thiếu |
| Import | Geometry manifest correctness | So `geometry_status`, IOP/IPP, normal, FrameOfReferenceUID, position range và slice spacing với fixture | Status đúng `valid/partial/incompatible/unknown`; không giả mapping khi frame khác |
| Import | Unsupported input handling | Thử ZIP/PNG/JPG hoặc file không phải DICOM; kiểm tra thông báo rõ và không tạo study rác | Bị từ chối đúng; không silent skip |
| Import | Duplicate/conflict behavior | Import lại cùng checksum và cùng SOP khác checksum | Reuse đúng; conflict không overwrite |
| Xóa | Delete correctness | Xóa study upload rồi kiểm tra list, API, file storage và DB | Study biến mất hoàn toàn; không đụng sample/study khác |
| Xóa | Delete safety | Thử xóa sample, study đang index, study không tồn tại, cleanup lỗi | Đúng lỗi `EXAMPLE_READ_ONLY`/`STUDY_BUSY`/`NOT_FOUND`/`DELETE_FAILED` |
| Xóa | Delete latency | Từ confirmation đến job terminal, tách cleanup file và DB | Ghi p50/p95 thực; không đặt số trước benchmark |
| Bền vững | Restart recovery | Kill/recreate API, worker, web ở các stage upload/index/commit/delete | Không mất committed data; job không RUNNING mãi |
| Bền vững | Seed idempotency | Restart và seed lại 3 lần | Vẫn đúng 1 sample study, 2 series, 64 files |
| Bền vững | Backup restore | Restore DB + raw files vào volume sạch | Count/checksum và mở ảnh khớp bản gốc |
| Hiệu năng | Upload throughput | MiB/s cho sample, tách browser→API và disk write | Ghi p50/p95; so trên cùng máy/network |
| Hiệu năng | Index duration | Từ complete đến READY/PARTIAL, theo stage validate/extract/index/commit | Ghi p50/p95 trên ít nhất 5 lần; không gọi một lần là p95 |
| Hiệu năng | First image time | Click Mở ảnh đến khi viewport đầu tiên hiển thị đúng | Tách cold/warm; ghi n và fixture |
| Hiệu năng | Cached slice switch | 100 lần chuyển lát trong cùng series | Mục tiêu thử p95 ≤100 ms, đo trên máy/browser ghi rõ |
| Hiệu năng | Memory stability | Mở/đổi study và series 10 lần; ghi browser JS heap nếu có + task manager | Không tăng liên tục; chênh lệch cuối/cuối cần giải thích |
| API | Error response correctness | Upload lỗi, delete sample, storage unavailable, queue full | Status/code/message/action tiếp theo nhất quán |
| UX | Task completion | Người dùng nội bộ thực hiện upload → mở → đổi series → xóa upload | 100% hoàn thành không cần can thiệp dev trên script nghiệm thu |
| UX | Error recovery | File lỗi, ZIP lỗi, delete lỗi, restart giữa job | Biết bước tiếp theo; không mắc ở loading |
| UX | Study tree behavior | Expand/collapse study và series; click caret, click label, kiểm tra selected series | Không mở nhầm study/series; không render hàng trăm filename mặc định |
| UX | Analyze placeholder safety | Bấm Analyze ở sample và study upload | Luôn hiện notice chưa kết nối AI/Triton; không score/result giả |
| UX | Display control behavior | Đổi contrast/brightness/invert rồi reset; so source image/API response | Thay đổi presentation có thể quan sát; Reset về default; DICOM nguồn không đổi |
| UX | Direction tab behavior | Click Overview, Sagittal, Coronal, Axial, Images / Series; kiểm tra Overview fit nhỏ gọn 4 ô, tab hướng viewport lớn fit trọn ảnh, Images / Series hiển thị browser series | 100%; không nhầm series/plane, tab không làm mất active slice |
| UX | Card selection and slice control | Click vùng ảnh SAG/COR/AX trong Overview, kiểm tra active series, footer `current / total`, Previous/Next Slice, zoom/pan và nút Open | Click card giữ Overview; chỉ card active nhận Slice/zoom/pan/reset; card khác không bị thay đổi; Open chuyển đúng tab hướng |
| UX | Image centering | Kiểm tra ảnh vuông và ảnh không vuông trong Overview/focused viewport ở các kích thước màn hình | Ảnh căn giữa ngang/dọc, giữ aspect ratio, không bị dồn xuống đáy |
| UX | Viewport zoom/pan/reset | Chọn lần lượt từng card, wheel hoặc pinch trên ảnh, kiểm tra tâm ảnh trước/sau zoom, thử Zoom out tại 100%, kéo pointer khi zoom, bấm `Reset view` trên card và `Reset` trên toolbar | Chỉ card active thay đổi zoom/pan; không zoom nhỏ hơn fit 100%; không có max nhân tạo; zoom quanh tâm viewport, không tự lùi xuống/đổi tâm; reset đưa ảnh về fit |
| UX | Overview aspect ratio | So sánh ảnh SAG/COR/AX trong Overview với native dimensions; kiểm tra ảnh không méo và ô đủ lớn để scan nhanh | Ảnh giữ aspect ratio; không bị ép thành cùng width/height hoặc letterbox quá mức |
| UX | Design-board parity | So layout tabs, 4-slot viewer, Study information panel với `design-board.html` ở 1440×900 | Không mất region/chức năng; sai lệch được ghi trong report |

## 2. Công thức và cách ghi

- `import_success_rate = READY imports / valid imports`. Đừng đưa file unsupported vào mẫu số; báo unsupported rate riêng.
- `delete_success_rate = DELETED studies / delete requests accepted`. Request bị từ chối vì sample hoặc study đang bận là safety behavior, không phải cleanup failure.
- `p50` là median, `p95` là percentile 95. Ghi số mẫu `n`, fixture checksum, CPU/RAM/disk, browser/OS, Docker image và trạng thái cold/warm.
- Ghi timestamp `upload_started`, `upload_completed`, `index_started`, `index_ready`, `delete_requested`, `delete_started`, `delete_finished`, `first_image_rendered`.
- Không dùng `progress=100%` làm mốc READY. READY là khi manifest và raw assets đã commit, query được và mở được ảnh.

## 3. Bộ test chạy trước bàn giao

1. Seed sample: xác nhận một `study_id`, hai `series_id`, 64 assets; mở cả `series_1` và `series_2`.
2. Upload folder chứa 64 file `.dcm`; so catalog, order và ảnh với sample.
3. Upload nhiều file `.dcm`; kiểm tra grouping không phụ thuộc thứ tự file được chọn.
4. Thử ZIP/PNG/JPG và file `.dcm` hỏng; kiểm tra bị từ chối hoặc report rõ, không silent skip.
5. Xóa study upload; refresh trang, gọi lại catalog, kiểm tra raw path và DB không còn asset của study đó.
6. Thử xóa sample và xóa study đang index; kiểm tra bị từ chối với lý do rõ.
7. Restart Compose giữa index và delete; kiểm tra recovery, seed idempotency và không xóa nhầm.
8. Restore một bản backup vào volume mới; mở lại sample và một study upload chưa xóa.
9. Kiểm tra cây Study → Series → slice, Analyze notice, direction tabs và display controls/reset.
10. Dùng wheel/pinch zoom và pointer drag pan ở Overview lẫn focused direction; kiểm tra ảnh không bị fit constraint khi zoom.
11. Gọi `GET /api/series/{id}/geometry` và đối chiếu manifest với DICOM header; kiểm tra study summary báo `Incompatible frames` khi các series không cùng FrameOfReferenceUID.
12. Chạy performance smoke trên cùng fixture, ghi p50/p95 và evidence.

## 4. Release gate

Block bàn giao nếu có: sai Study/Series UID, sai slice order, ảnh cũ dưới tên series mới, mất file sau restart, xóa nhầm sample/study khác, cleanup báo thành công nhưng file còn lại, job treo RUNNING, hoặc lỗi import bị bỏ qua không báo.

Có thể bàn giao với metric hiệu năng chưa đạt mục tiêu nếu đã ghi số đo thật và lý do. Không bàn giao khi chưa biết metric đo trên fixture/máy nào.
