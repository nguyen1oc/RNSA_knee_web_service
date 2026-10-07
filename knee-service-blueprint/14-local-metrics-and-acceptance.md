# 14 — Metrics đánh giá local viewer

> **Cập nhật gần nhất:** 2026-10-07
> **Thay đổi gần nhất:** Acceptance kiểm tra zoom in/out MRI Volume qua mức fit ban đầu, với sàn an toàn 1%.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

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
| UX | Direction tab behavior | Click Overview, Sagittal, Coronal, Axial, Images / Series; đổi MPR source ở Overview; kiểm tra cả 3 MPR + volume cùng reload từ một nguồn, tab hướng mở acquisition gốc, Images / Series hiển thị browser | 100%; không ghép acquisition khác nhau; nguồn không đủ điều kiện phải báo lý do và giữ stack gốc truy cập được |
| UX | Linked MPR Overview | Chọn series đủ geometry; thay slice/crosshair trong từng plane, quan sát các plane và khung cắt trong volume 3D | Ba mặt phẳng và volume cùng series, cùng tọa độ; không lấy/ghép nhầm acquisition khác |
| UX | Image centering | Kiểm tra ảnh MPR và ảnh stack gốc trong tab hướng ở các kích thước màn hình | Ảnh căn giữa ngang/dọc, giữ aspect ratio, không bị dồn xuống đáy |
| UX | Viewport zoom/pan/reset | Direction tab: zoom/pan/reset từng stack; Overview: right-drag zoom, tool Pan, Reset volume/MPR | Thao tác đúng viewport, không scroll trang; minimum fit được giữ; Reset khôi phục camera/view mặc định |
| UX | MPR aspect ratio | So sánh ba mặt phẳng tái tạo trong Overview và layout variants | Ảnh giữ aspect ratio; không bị ép méo; viewport co giãn mà volume và MPR vẫn đọc được |
| UX | MPR slice and scroll ownership | Chọn từng mặt phẳng Overview, dùng wheel/drag và crosshair | Chỉ plane tương ứng đổi vị trí; các mặt phẳng khác theo cùng tọa độ; wheel không scroll body |
| UX | Focused multi-view layout | Trong Sagittal/Coronal/Axial mở một Layout dropdown, chọn `1x1`, `2x2`, rê chuột trên bảng 4×4 để preview và click vùng tới `4x4`; kiểm tra cùng series, label viewport và slice position | Đủ viewport, không lẫn series/hướng, ảnh giữ aspect ratio; grid không vượt 16 ô |
| UX | Focused viewport ownership | Click viewport A/B/C/D, dùng rail slice/zoom/pan/reset và đổi active viewport | Chỉ viewport được chọn nhận thao tác; viewport khác giữ state; mỗi ô có control riêng |
| UX | Vertical slice rail | Mở direction mới và dùng slider bên phải từng viewport ở layout 1x1/2x2 | Series mới bắt đầu ở `1 / total`; slider đổi đúng ô được chọn và khóa khi ảnh chưa load; wheel trên rail đổi từng slice; các ô khác không đổi khi Sync slices tắt |
| UX | Pointer default and local zoom | Không chọn tool vẽ, click từng viewport, bấm `+`, kéo ảnh sau zoom và bấm `Reset` tại ô | Tool mặc định là Pointer; zoom/pan/reset hoạt động trên viewport đang chọn; zoom out bị khóa ở fit 100% |
| UX | Slice synchronization | Bật/tắt `Sync slices`, kéo range hoặc dùng prev/next trong từng viewport, sau đó dùng toolbar | Tắt: chỉ viewport active/viewport được thao tác đổi; bật: các viewport cùng series đổi cùng index |
| UX | Wheel slice navigation | Chọn Pan, đặt con trỏ trên viewport, lướt xuống/lên ở layout 1x1/2x2 | Xuống tăng slice đúng một bước, lên giảm một bước, không đổi zoom và không scroll trang |
| UX | Tool affordance and measurement labels | Mở tool picker và tạo Length/Rectangle/Ellipse khi có/không có PixelSpacing | Mỗi tool có icon dễ nhận biết; số đo dùng font dễ đọc và hiển thị px hoặc mm đúng trạng thái calibration |
| UX | Preview annotation tools | Chọn dropdown Length/Rectangle/Ellipse/Freehand/Arrow + note; vẽ trong viewport; kiểm tra label và editor; đổi slice | Overlay đúng viewport + slice; Length/shape có px hoặc mm khi PixelSpacing hợp lệ; Arrow + note mở editor inline; không đổi DICOM nguồn |
> Wheel slice test uses the default `Pointer` tool; “Pan” in the older row above is historical wording.
| UX | Delete preview marks | Vẽ nhiều mark trên cùng slice, chọn Eraser và click một mark; thử Clear all trong menu phụ | Eraser chỉ xóa mark được click; Clear all yêu cầu xác nhận rồi xóa mark trên slice hiện tại; không xóa mark ở slice khác |
| UX | Image capture | Mở Capture, đổi PNG/JPEG, 512×512/256×256/128×128, bật/tắt annotation và metadata | Preview khớp output; download đúng format và kích thước vuông; ảnh không crop/stretch; overlay theo lựa chọn |
| UX | Crosshair geometry gating | Chọn series MPR không đạt geometry gate và series đạt gate | Series lỗi hiện lý do, control bị khóa; series hợp lệ bật crosshair theo tọa độ volume, không dựa vào geometry study-wide |
| UX | Linked MPR + 3D volume | Ở Overview với series hợp lệ; so volume nguồn; xoay 3D, đổi preset/projection, thao tác crosshair và scroll các mặt phẳng | Cả bốn viewport cùng một volume; 3D xoay/reset hoạt động; MIP dùng maximum-intensity blend; crosshair/slice ba mặt khớp; không nạp ảnh PNG thay volume |
| UX | Overview layout and volume controls | Chọn `3D four-up`, `3D primary`, `3D main`; đổi MPR source; kéo vòng đỏ/vàng/xanh lá; thử zoom − xuống dưới fit, zoom + và Reset; kiểm tra vòng chỉ xuất hiện ở MRI Volume; kéo nền volume và các plane; đổi Standard MR/Angio-style và Composite/MIP | Zoom − đi qua 100% đến sàn an toàn 1%, zoom + tăng và phần trăm cập nhật; Reset trả volume về fit; zoom chỉ ảnh hưởng camera volume, không đổi slice; vòng đúng màu/trục; MIP bật maximum-intensity projection thật |
| UX | MPR geometry fallback | Chọn series geometry thiếu/không hợp lệ | Overview nêu rõ lý do; không giả tạo 3D; acquisition gốc vẫn mở được ở direction tabs/Images / Series |
| UX | Design-board parity | So Overview MPR 4-slot, tabs, Study information panel với `design-board.html` ở 1440×900 | Không mất region/chức năng; sai lệch được ghi trong report |
| UX | Study metadata and Analyze feedback | Mở study có UID dài/frame mismatch; bấm Analyze | Geometry explanation căn trái, không bị cắt; UID wrap trong panel; Analyze notice nằm trong content flow, không đè workspace |

## 2. Công thức và cách ghi

- `import_success_rate = READY imports / valid imports`. Đừng đưa file unsupported vào mẫu số; báo unsupported rate riêng.
- `delete_success_rate = DELETED studies / delete requests accepted`. Request bị từ chối vì sample hoặc study đang bận là safety behavior, không phải cleanup failure.
- `p50` là median, `p95` là percentile 95. Ghi số mẫu `n`, fixture checksum, CPU/RAM/disk, browser/OS, Docker image và trạng thái cold/warm.
- Ghi timestamp `upload_started`, `upload_completed`, `index_started`, `index_ready`, `delete_requested`, `delete_started`, `delete_finished`, `first_image_rendered`.
- Không dùng `progress=100%` làm mốc READY. READY là khi manifest và raw assets đã commit, query được và mở được ảnh.

## 3. Bộ test chạy trước bàn giao

1. Seed `results.zip`: xác nhận một `study_id`, 5 series và 284 assets; mở cây Study → Series → DICOM.
2. Upload lại một ZIP làm study user; so catalog, order và số ảnh với example.
3. Upload nhiều file `.dcm`; kiểm tra grouping không phụ thuộc thứ tự file được chọn.
4. Thử ZIP/PNG/JPG và file `.dcm` hỏng; kiểm tra bị từ chối hoặc report rõ, không silent skip.
5. Xóa study upload; refresh trang, gọi lại catalog, kiểm tra raw path và DB không còn asset của study đó.
6. Thử xóa sample; kiểm tra bị từ chối với HTTP 409 và example vẫn còn.
7. Restart Compose; kiểm tra recovery, seed idempotency và không xóa nhầm.
8. Restore một bản backup vào volume mới; mở lại sample và một study upload chưa xóa.
9. Kiểm tra cây Study → Series → slice, Analyze notice, direction tabs và display controls/reset.
10. Dùng Zoom controls và pointer drag pan ở Overview lẫn focused direction; trong focused direction dùng wheel đổi slice lên/xuống và kiểm tra ảnh không bị fit constraint khi zoom.
11. Gọi `GET /api/series/{id}/geometry` và đối chiếu manifest với DICOM header; kiểm tra study summary báo `Incompatible frames` khi các series không cùng FrameOfReferenceUID.
12. Chạy performance smoke trên cùng fixture, ghi p50/p95 và evidence.
13. Trong focused tab kiểm tra một Layout dropdown với preset/custom tới 4x4, hover preview, slice slider/prev/next, wheel navigation, Sync slices, dropdown tools/metrics, annotation editor và Capture PNG/JPEG.
14. Chạy `python -m pytest -q`; tất cả test ZIP, seed, read-only delete và cleanup phải pass.

## 4. Release gate

Block bàn giao nếu có: sai Study/Series UID, sai slice order, ảnh cũ dưới tên series mới, mất file sau restart, xóa nhầm sample/study khác, cleanup báo thành công nhưng file còn lại, job treo RUNNING, hoặc lỗi import bị bỏ qua không báo.

Có thể bàn giao với metric hiệu năng chưa đạt mục tiêu nếu đã ghi số đo thật và lý do. Không bàn giao khi chưa biết metric đo trên fixture/máy nào.
