# 00 — Workflow local và màn hình cần xây

Phạm vi 05/10/2026: không tài khoản, mật khẩu, IAP hoặc identity gate. Vào thẳng danh sách study. Upload đi qua ingest pipeline; workspace có nút **Analyze** để giữ đúng workflow tương lai, nhưng hiện chỉ hiển thị thông báo “coming soon”; chưa có model, AI panel, score hoặc endpoint inference.

## 1. User flow

```mermaid
flowchart TD
    Open([Mở localhost:8080]) --> Home[Danh sách study]
    Home --> Example[Một study mẫu · 2 series]
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
    Viewer --> Analyze[Analyze · coming soon]
    Analyze --> Notice[Thông báo: AI/Triton chưa kết nối]
    Controls --> Series
    Viewer --> Home
```

Không cần upload lại examples mỗi lần vào web. Nếu nguồn mẫu chưa có, card hiện “Chưa có dữ liệu mẫu”; không báo READY. Upload progress và index progress là hai giai đoạn riêng.

## 2. Các màn hình

| Vị trí | Features |
|---|---|
| `/studies` | Một example study gồm 2 series; study đã nhập; số series/ảnh, trạng thái, Mở ảnh, Xóa |
| Dialog Nhập study | Chọn một hoặc nhiều file `.dcm`, hoặc thư mục `.dcm`; progress; kết quả/error theo file |
| `/studies/:id` | Header study, nút Analyze, sidebar cây Study → Series → slice files, tabs, viewer 4 ô, toolbar và panel thông tin |
| Panel thông tin | Loại nguồn, count, Study UID rút gọn và trạng thái từng ingest stage |
| Xác nhận xóa | Chỉ study upload; example read-only; đang index thì chưa xóa |

Header không có Tài khoản/Đăng xuất. Nút Analyze chỉ là CTA được hiển thị trước; không được tạo score giả, AI result hoặc trạng thái “analyzed”.

## 3. Trang đầu

```text
Knee Review                                        [+ Nhập study]
Study mẫu
[Demo study · 2 series · Mở ảnh]

Study đã nhập
Tên           Series/Ảnh       Trạng thái    Mở / Xóa
DEMO-KNEE     2 / 64           Sẵn sàng      Mở ảnh
...           ...              Sẵn sàng      Mở / Xóa
```

Example label/count lấy từ backend. “Study đã nhập” có empty state riêng khi chưa upload; sample read-only vẫn hiện.

## 4. Workspace và capabilities

DICOM giữ layout tổng quan 4 ô: trên trái là 3D locator/khung định hướng chưa gắn anatomy bệnh nhân, ba ô còn lại SAG/COR/AX nếu có series đúng hướng. Bố cục có tabs theo hướng và panel Study information bên phải. Tab **Overview** là snapshot để so sánh nhanh các hướng, nên các ô lớn hơn và ảnh tự fit theo aspect ratio gốc để nhìn đồng thời cả 4 ô; không kéo méo ảnh và không phải nơi đọc chi tiết. Tab **Sagittal**, **Coronal** hoặc **Axial** chuyển hướng tương ứng thành một viewport lớn để đọc stack đó, mặc định fit toàn bộ ảnh trong viewport. Tab **Images / Series** là browser của các acquisition: hiển thị từng series, lát đại diện, plane, số lát và FS/fluid metadata để chọn series; nó không phải bản sao của Overview. Không có hướng nào thì viewport hiện “No [direction] series”. Có nhiều series cùng hướng thì chọn từng series; không chia study thành đúng 6 series.

DICOM không xác định được hướng thì mở bằng stack lớn và không ép vào SAG/COR/AX. Người dùng vẫn chọn series, lướt ảnh và zoom/pan.

| Control | DICOM |
|---|---|
| Chọn ô, series, scroll/slider, zoom/pan/reset | Bấm vùng ảnh để chọn series active trong Overview nhưng không đổi tab; chỉ ô đang active nhận Slice toolbar, wheel/pinch zoom, pointer pan và Reset view; `Open` là hành động chuyển sang tab hướng |
| Contrast/Brightness/Invert preview | Có trong local UI; chỉ thay CSS presentation, không sửa DICOM |
| Window width/level DICOM | Adapter đầy đủ là bước tiếp theo; không gọi preview hiện tại là calibration chẩn đoán |
| Ingest pipeline status | Panel phải hiển thị validate, metadata, grouping, sorting complete; preview on-demand |
| Hướng, FS, fluid | Có UNKNOWN và nguồn nhãn |
| Tọa độ bệnh nhân/thước mm | Chỉ khi metadata đủ; thước đo chưa thuộc P0 |
| MPR/crosshair/3D | P1 có geometry gate |
| Xóa study upload | Có xác nhận; sample read-only |

Sidebar là cây có thể expand/collapse: study → series → một vài filename đại diện và tổng số slice. Không render hàng trăm filename cùng lúc. Click tên study/series sẽ mở viewer; click caret chỉ điều khiển expand. Ở viewport fit, ảnh nằm gọn trong khung theo đúng tỉ lệ; mức zoom tối thiểu là kích thước fit ban đầu (`100%`), Zoom out bị khóa tại mức này; Zoom in không đặt trần nhân tạo. Khi zoom bằng toolbar hoặc wheel/pinch, giới hạn fit được bỏ để ảnh có thể tràn dưới viewport và kéo pan bằng chuột/touch. Trong Overview, click ô khác chỉ đổi ô active; các control zoom/pan/slice không tác động lên ô không active. Nút `Reset view` trên card và `Reset` trên toolbar đưa zoom, pan và fit về mặc định trước khi zoom. Zoom/preview display chỉ thay hiển thị, không sửa file gốc. Nhãn và ảnh phải luôn thuộc cùng series.

Khi mở một series lần đầu, viewer chọn lát đại diện ở giữa stack thay vì lát đầu tiên. Người dùng vẫn có thể lùi/tới từng lát bằng control Slice; đây chỉ là initial-view heuristic, không phải một lựa chọn chẩn đoán.

## 5. Ưu tiên build

L01 Docker/shell → L02 API/import DICOM + một stack → L03 sample/list → L04 workspace tree + display controls → L05 xóa/persistence → L06 restart/lỗi/QA. Analyze CTA chỉ là placeholder trong local; inference/Triton làm sau. Chi tiết step và acceptance ở [12](12-local-docker-build-steps.md), lịch hai người ở [11](11-team-rebalance-and-vibe-frontend.md).

Walkthrough nghiệm thu: mở sample study → expand cây Study/Series → ở Overview bấm từng ô để đổi active series nhưng vẫn ở Overview → dùng Slice previous/next và kiểm tra `current / total` trên footer → thử zoom/pan chỉ trên ô active → bấm `Open` để chuyển sang tab hướng → nhập file hoặc folder DICOM → mở một series → lướt/zoom/contrast → bấm Analyze để kiểm tra thông báo chưa kết nối → xóa study upload → refresh → restart Docker → mở lại sample và kiểm tra seed không nhân bản.
