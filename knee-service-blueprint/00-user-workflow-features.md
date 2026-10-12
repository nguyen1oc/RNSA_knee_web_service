# 00 — Workflow local và màn hình cần xây

> **Cập nhật gần nhất:** 2026-10-13
> **Thay đổi gần nhất:** Workflow `dev`/`main` đã được kiểm tra và cấu hình Triton riêng theo môi trường; API health và trạng thái Triton production đã được xác nhận trên GCP ngày 13/10. Xem [21 — tài liệu bàn giao](21-project-handover.md); health/readiness chưa thay thế lượt Analyze end-to-end.
> **Thay đổi trước đó:** Tab MPR có volume intensity 3D xoay được từ cùng series; đã làm rõ MR/FS, presets và giới hạn camera/MPR.
> **Lịch sử trước đó:** Panel thông tin hiện đầy đủ Study UID; Capture có preview, preset mới là 64/128/512 px.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Ứng dụng không yêu cầu tài khoản hoặc mật khẩu. Mỗi browser có temporary workspace; HttpOnly cookie cô lập study đã upload. Analyze gửi yêu cầu theo study tới API. Trên cloud, API chuẩn bị dữ liệu và gọi Triton; local chỉ chạy inference khi đã cấu hình checkpoint. API trả 12 model scores. Giao diện ghi kết quả theo study trong tab hiện tại để người dùng chuyển series hoặc hướng xem mà không mất kết quả; điều này không đồng nghĩa kết quả được lưu lâu dài trên server. Điểm số chưa được calibration và không phải kết luận chẩn đoán. Xem [21 — tài liệu bàn giao](21-project-handover.md) để biết trạng thái môi trường.

## 1. User flow

```mermaid
flowchart TD
    Open([Mở localhost:8080]) --> Home[Danh sách study]
    Home --> Example[Một study mẫu · 5 series]
    Example -->|Mở sample| Viewer[Workspace]
    Home -->|Nhập study| Upload[Chọn file hoặc folder .dcm]
    Upload --> Progress[Validate → metadata → group → sort]
    Progress --> Preview[Render preview on demand]
    Preview --> Summary[Kết quả: study, series, file lỗi]
    Summary -->|Có ảnh hợp lệ| Viewer
    Summary -->|Không có ảnh hợp lệ| Retry[Chọn lại nguồn]
    Retry --> Upload
    Home -->|Mở study đã nhập| Viewer
    Viewer --> Tree[Expand Study → Series → slice files]
    Tree --> Series[Chọn series và lướt ảnh]
    Series --> Controls[Zoom, pan, chỉnh hiển thị, phóng lớn ô]
    Viewer --> Analyze[Analyze · gọi API theo study]
    Analyze --> Scores[AI Analysis · 12 model scores]
    Scores -->|Study information| Info[Quay lại Study Information]
    Controls --> Series
    Viewer --> Home
```

Không cần upload lại examples mỗi lần vào web. Nếu nguồn mẫu chưa có, card hiện “Chưa có dữ liệu mẫu”; không báo READY. Upload progress và index progress là hai giai đoạn riêng.

## 2. Các màn hình

| Vị trí | Features |
|---|---|
| `/studies` | Example study dùng chung (staging đã ghi nhận 5 series/284 ảnh); study đã nhập; số series/ảnh, trạng thái, Mở ảnh, Xóa |
| Dialog Nhập study | Chọn một hoặc nhiều file `.dcm`, hoặc thư mục `.dcm`; progress; kết quả/error theo file |
| `/studies/:id` | Header study, nút Analyze, sidebar cây Study → Series → slice files, tabs, viewer 4 ô, toolbar và panel thông tin |
| Panel thông tin | Loại nguồn, count, Study UID đầy đủ (tự xuống dòng) và trạng thái từng ingest stage; geometry mismatch căn trái và có giải thích |
| Xác nhận xóa | Chỉ study upload; example read-only; đang index thì chưa xóa |

Header không có Tài khoản/Đăng xuất. Nếu inference chưa sẵn sàng hoặc thất bại, giao diện phải báo lỗi rõ ràng; không hiển thị điểm giả. Panel có đường quay lại Study Information.

## 3. Trang đầu

```text
Knee Review                                        [+ Nhập study]
Study mẫu
[Demo study · 5 series · Mở ảnh]

Study đã nhập
Tên           Series/Ảnh       Trạng thái    Mở / Xóa
DEMO-KNEE     2 / 64           Sẵn sàng      Mở ảnh
...           ...              Sẵn sàng      Mở / Xóa
```

Example label/count lấy từ backend. “Study đã nhập” có empty state riêng khi chưa upload; sample read-only vẫn hiện.

## 4. Workspace và capabilities

DICOM mở ở **Overview** gồm bốn viewport dựng từ cùng một series hợp lệ: volume MRI 3D và ba mặt phẳng axial/coronal/sagittal được tái tạo (MPR), liên kết crosshair và slice. Chọn một nguồn tại **MPR source**; đổi nguồn sẽ dựng lại cả bốn viewport cùng nhau. Mặc định ưu tiên geometry metadata hợp lệ, sau đó sagittal và số lát nhiều hơn, nhưng volume eligibility vẫn được kiểm tra riêng. Ba layout cho phép ưu tiên volume hoặc so sánh các mặt phẳng. Nếu series không đủ geometry để tạo volume, báo lý do và tiếp tục mở acquisition gốc ở các tab hướng. Tab **Sagittal**, **Coronal** hoặc **Axial** mở acquisition gốc theo hướng để đọc stack; tab **Images / Series** là browser của toàn bộ acquisition và metadata, không phải bản sao MPR. MPR không ghép các series hay sequence khác nhau.

DICOM không xác định được hướng thì mở bằng stack lớn và không ép vào SAG/COR/AX. Người dùng vẫn chọn series, lướt ảnh và zoom/pan.

| Control | DICOM |
|---|---|
| Overview MPR interaction | Chọn một nguồn ở MPR source; crosshair liên kết ba mặt phẳng; wheel/drag mặt phẳng đổi vị trí tương ứng; kéo ba vòng gizmo màu để xoay camera volume độc lập. Các tab hướng vẫn mở acquisition gốc. |
| Contrast/Brightness/Invert preview | Có trong local UI; chỉ thay CSS presentation, không sửa DICOM |
| Window width/level DICOM | Adapter đầy đủ là bước tiếp theo; không gọi preview hiện tại là calibration chẩn đoán |
| Ingest pipeline status | Panel phải hiển thị validate, metadata, grouping, sorting complete; preview on-demand |
| Hướng, FS, fluid | Có UNKNOWN và nguồn nhãn |
| Tọa độ bệnh nhân/thước mm | Chỉ khi metadata đủ; thước đo chưa thuộc P0 |
| MPR/crosshair/3D | Overview hiện có geometry gate; ba mặt MPR + MRI volume 3D xoay camera từ cùng series, không phải segmentation |
| Xóa study upload | Có xác nhận; sample read-only |

Sidebar là cây có thể expand/collapse: study → series → một vài filename đại diện và tổng số slice. Không render hàng trăm filename cùng lúc. Click tên study/series sẽ mở viewer; click caret chỉ điều khiển expand. Overview MPR luôn dùng cùng một series nguồn; các mặt phẳng thay đổi theo vị trí world trong volume, còn xoay camera 3D không đổi hướng MPR. Các tab hướng vẫn xem stack acquisition gốc. Geometry không hợp lệ thì không tạo MPR giả; dùng các tab hướng/Images / Series để xem dữ liệu gốc.

Khi mở một series lần đầu, viewer chọn lát đại diện ở giữa stack thay vì lát đầu tiên. Người dùng vẫn có thể lùi/tới từng lát bằng control Slice; đây chỉ là initial-view heuristic, không phải một lựa chọn chẩn đoán.

## 5. Ưu tiên build

Thứ tự L01–L06 dưới đây là kế hoạch build ban đầu cho local viewer, không phải trạng thái hiện tại của AI serving. Luồng Analyze hiện đã được nối với API/Triton ở staging. Chi tiết triển khai hiện tại nằm trong [20 — Triton trên Cloud Run GPU](20-triton-cloudrun-gpu.md); tiêu chí QA lịch sử ở [12](12-local-docker-build-steps.md) và [14](14-local-metrics-and-acceptance.md).

Walkthrough nghiệm thu viewer: mở sample study → expand Study/Series → chọn nguồn ở Overview → kiểm tra volume và ba MPR → thử crosshair, slice, xoay volume và layout → mở các tab hướng → nhập DICOM → xóa study upload → refresh/restart và kiểm tra dữ liệu mẫu. Walkthrough Analyze riêng: dùng study mẫu đã de-identify, bấm Analyze, xác nhận API trả đủ 12 scores, thử đổi series/tab rồi quay lại kết quả. Không dùng điểm số để đưa ra kết luận y khoa.
