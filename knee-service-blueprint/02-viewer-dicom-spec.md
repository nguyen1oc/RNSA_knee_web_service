# 02 — Viewer và DICOM

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Chuẩn hóa metadata tài liệu; contract viewer/DICOM hiện hành được giữ nguyên.  
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

> Phạm vi 05/10/2026: chỉ DICOM `.dcm` cho local viewer. Nút Analyze có mặt để giữ workflow nhưng chỉ báo “coming soon”; chưa có AI panel/model. Các đoạn mô tả MPR/3D bên dưới là P1 sau P0, không bắt buộc sprint này. Seed và input theo [13](13-input-formats-and-example-studies.md).

## Mô hình thông tin

Study → Series → SOP Instance → Frame. DICOM multi-frame không tương đương một file/một slice. Một ZIP có thể chứa nhiều study; UI liệt kê sau index, không trộn.

- Group bằng StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID; frame number dùng quy ước DICOM 1-based trong API.
- Series inventory giữ ảnh gốc và metadata; display stack có thể phải tách theo orientation/echo/timepoint trước khi render.
- Thiếu UID/geometry không tự bịa UID rồi coi như hợp lệ; giữ error/quarantine hoặc stack fallback có nhãn.

## Slot là lớp phân loại, không phải viewport

Viewer cung cấp 6 nhóm hướng × FS: SAG_FS, SAG_NOFS, COR_FS, COR_NOFS, AX_FS, AX_NOFS; thêm UNKNOWN. Mỗi nhóm có 0..N series.

Model dùng schema riêng theo version. Workspace còn có recovered schema và baseline 4-slot; không suy model cần đủ sáu nhóm viewer.

FS và fluid-sensitive là hai trường nullable độc lập. NOFS không tự suy thành T1. Mỗi nhãn có source: dataset_metadata, dicom_header_rule, manual hoặc unknown; heuristic không được hiện như annotation đã xác minh. Dữ liệu bệnh viện không mặc định có các cột CSV của dataset.

## Bố cục

Desktop mục tiêu ≥1280×800; khuyến nghị 1440×900. Sidebar 248 px thu gọn được; viewer co giãn; panel Study information khoảng 276–304 px. Không có AI panel ở phase local. Màn nhỏ chuyển một viewport với panel thông tin xếp dưới; không hứa trải nghiệm 4 ô trên điện thoại.

| Tab | Nội dung |
|---|---|
| Tổng quan | Snapshot 4 ô để so sánh nhanh; 3D locator ở trên trái, ba ô SAG/COR/AX có kích thước đủ đọc nhanh và fit theo aspect ratio gốc, panel phải hiển thị study + ingest pipeline |
| Sagittal / Coronal / Axial | Hướng được chọn trở thành một viewport lớn; toolbar Slice và active series điều khiển stack đó |
| Images / Series | Browser các acquisition/series với lát đại diện và metadata; chọn một series rồi chuyển sang tab hướng để đọc chi tiết |
| Stack / Series | Một stack cho DICOM chưa xác định hướng; không ép vào ba hướng |
| MPR — P1 | Chưa hiện tab ở local P0; khi triển khai chọn một volume hợp lệ để tái tạo |

Sidebar dùng tree: Study row → Series row → danh sách ngắn các filename slice khi expand. Mỗi series vẫn có thumbnail/description, hướng, FS, fluid-sensitive, số frame và trạng thái load. Không liệt kê hàng nghìn tên DICOM mặc định; chỉ hiện vài filename đại diện và tổng số slice. Không có badge “AI đang dùng” hoặc score trong phase local; Analyze chỉ là CTA placeholder.

DICOM ingest dùng full pixel data, rescale và Window Center/Width nếu metadata có; nếu thiếu thì fallback percentile preview có nhãn. Thiếu geometry thì plane/FS/fluid là UNKNOWN, tắt MPR/crosshair vật lý/thước mm. Không thay DICOM full-depth bằng thumbnail. Loader/assets phải được bundle local để không lệ thuộc CDN lúc mở ảnh.

## Ingest pipeline P0

Mỗi upload `.dcm` chạy một pipeline đồng bộ trong local vertical slice: validate file/header/pixel payload → extract Study/Series/SOP, IOP/IPP, PixelSpacing, FrameOfReferenceUID và vị trí → group theo UID → validate geometry theo series → sort theo physical position khi có geometry, fallback InstanceNumber khi thiếu → lưu manifest trong SQLite → render PNG preview on demand. API study trả geometry summary của toàn study; endpoint `/api/studies/{study_id}/pipeline` đọc stage, còn `/api/series/{series_id}/geometry` trả geometry manifest của một series.

## Phân biệt native và MPR

- Native: ba series thu nhận khác nhau, không giả định cùng số lát/contrast/resolution.
- MPR: tái tạo ba hướng từ một volume; ghi “Tái tạo” và series nguồn trên từng ô.
- Không gộp pixel SAG/COR/AX thành volume chung hoặc nội suy để che slice bị thiếu.
- Kiểm tra IOP/IPP, PixelSpacing, kích thước, orientation, bước lát, duplicate/gap và nhóm frame trước dựng volume.
- Lát dày/anisotropic có thể tái tạo nhưng cần ghi giới hạn; spacing sau resample không đồng nghĩa độ phân giải thu nhận thật.
- Đồng bộ cùng volume bằng tọa độ patient. Khác series chỉ cho phép khi geometry và FrameOfReference phù hợp; vẫn ghi hạn chế motion giữa acquisition. Không có registration tự động trong MVP.

## Sắp lát và định hướng

Với nhóm có orientation nhất quán: normal = cross(rowDirection, columnDirection), sắp theo dot(IPP, normal). Không sort chỉ theo z hoặc filename. Geometry status `valid` yêu cầu IOP, IPP, PixelSpacing và dimensions hợp lệ; khác FrameOfReferenceUID/orientation/dimensions trong cùng series là `incompatible`, thiếu một phần là `partial`, thiếu toàn bộ là `unknown`. Nếu thiếu geometry, cho stack fallback InstanceNumber có nhãn; tắt MPR và liên kết vật lý.

Định hướng R/L/A/P/S/I lấy từ geometry, kiểm tra bằng viewer tham chiếu. Laterality của đầu gối lấy từ metadata phù hợp và để UNKNOWN nếu chưa biết, không suy từ vị trí trên màn hình. Số lát hiển thị 1-based; lưu SOP/frame để giữ đúng ảnh khi đổi sort.

## Thao tác

| Thao tác | Hành vi |
|---|---|
| Click viewport | Đặt active viewport, viền focus rõ |
| Click image card trong Overview | Chọn series của card làm active nhưng giữ tab Overview; Slice toolbar sau đó điều khiển stack vừa chọn |
| Ownership của viewport controls | Chỉ active card/series nhận Slice toolbar, wheel/pinch zoom, pointer pan và Reset view; click card khác chỉ đổi active |
| Previous / Next Slice | Chỉ lướt stack của active series; click card khác trước để đổi active, không chuyển tab; lần mở đầu lấy lát giữa làm preview đại diện |
| Wheel / pinch | Zoom viewport từ 100% (fit mặc định) trở lên quanh tâm viewport; không kéo trang; không có max zoom nhân tạo; khi zoom > 100% ảnh không còn bị giới hạn bởi kích thước fit của khung |
| Kéo pointer/touch trong ảnh | Pan ảnh khi đang zoom; viewport giữ overflow hidden có chủ đích để ảnh di chuyển dưới khung đọc; zoom không tự đổi tâm ảnh |
| Toolbar Zoom / Pan / W-L + kéo chuột | Công cụ tường minh; keyboard vẫn dùng được |
| Contrast / Brightness / Invert preview | Điều chỉnh khả năng đọc ảnh trong local UI; reset được; không sửa DICOM |
| Double-click | Không đổi tab; dùng `Open` để chuyển direction |
| Open trên image card | Chuyển sang tab Sagittal/Coronal/Axial tương ứng với series của card |
| Reset view trên card / Reset toolbar | Reset zoom, pan và fit về mặc định trước khi zoom, không đổi input AI |
| Crosshair MPR | Chọn tọa độ 3D, cập nhật ba mặt phẳng cùng volume |
| Link toggle | Mặc định tắt giữa các series; chọn sync vị trí/zoom/W-L riêng |

State theo study + series + viewport: SOP/frame, camera, zoom, pan, window/level, inversion và slice position. Footer mỗi image card hiển thị `current / total`; Slice toolbar luôn điều khiển active series. Overview ưu tiên fit theo aspect ratio để so sánh; focused direction ưu tiên fit toàn bộ ảnh rồi cho phép zoom/pan. Click card chọn active mà không đổi tab; `Open` chuyển tab hướng. `Reset view` và toolbar `Reset` đưa camera về fit mặc định. Đổi tab rồi quay lại giữ state trong phiên. Persist layout tuỳ chọn, không cần persist toàn bộ camera trong MVP.

## Window/level và 3D

Spec đích có hai thanh Window width (>0) và Window level; kèm số, reset và DICOM-default/auto preset. Vertical slice hiện tại dùng Contrast/Brightness/Invert preview để cải thiện ảnh PNG render từ backend; đây chưa phải DICOM W/L calibration. Auto preset tương lai phải tính trên mẫu series đã xác định, không auto-normalize từng slice làm nhấp nháy khi scroll. Giữ đầy đủ bit depth và rescale theo DICOM/loader; MONOCHROME1 inversion đúng.

FS/fluid là filter/badge để chọn acquisition; không có toggle biến non-FS thành FS. W-L, opacity và zoom không sửa pixel nguồn hoặc tensor inference.

Ô 3D có mặt phẳng cắt với tên hướng; kéo mặt phẳng để đổi vị trí. Picking một điểm trong khối bán trong suốt phải có quy ước độ sâu riêng nên để P2. Volume rendering không mặc định tạo mô hình giải phẫu đã phân đoạn.

### Cấu hình ô 3D và mô hình tải sẵn

MVP đề xuất là **định vị không gian từ dữ liệu DICOM của study**, chưa phải một mesh khớp gối tách xương/sụn. Dựng khung thể tích và các mặt phẳng ảnh theo IPP/IOP/spacing; xoay/zoom khung nhìn và kéo mặt phẳng để chọn lát. Ở overview native, mỗi series chỉ nối tới hệ tọa độ chung khi geometry/frame of reference tương thích; ngoài trường hợp đó không giả đồng bộ.

Trong tab MPR, chọn một series phù hợp, tạo volume và ba mặt phẳng liên kết cùng tọa độ. Volume rendering thật là phần bổ sung: cần opacity/transfer function phù hợp MRI, chất lượng phụ thuộc acquisition; không dùng mặc định CT-bone để hứa hiển thị xương MRI rõ. Cornerstone có volume/MPR/3D viewport; cấu hình cụ thể pin theo version và fixture ngày 2.

Model giải phẫu 3D tải sẵn (GLB/glTF) chỉ dùng làm hình minh họa/định hướng chung, phải ghi “Giải phẫu tham khảo”; kiểm tra license và attribution. Không đại diện anatomy của bệnh nhân và không có mapping chính xác click → slice nếu chưa registration. Không cần tải asset này để làm MPR hoặc khung định vị từ DICOM.

Muốn mesh xương/sụn đúng bệnh nhân: cần segmentation MRI → mask → surface mesh; đây là pipeline riêng, ngoài MVP hiện tại. Model phân loại bệnh trên Triton không tự sinh mesh hay segmentation.

Nền renderer cả 3D/2D dùng màu sáng theo design system. Điều này chỉ đổi khoảng nền canvas; không invert ảnh, xóa background tối trong pixel hoặc đổi normalization AI.

## Trạng thái bắt buộc

Empty, uploading, indexing, loading/decode, ready, partial, unsupported codec/frame, missing geometry, memory limit, failed. Phân biệt “không có series” với “chưa index/nạp xong”. Ô lỗi có nguyên nhân, retry/chọn series khác; không hiển thị ảnh cũ dưới tên series mới.

Nguồn kỹ thuật: [Cornerstone viewports](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/viewports/), [OHIF viewport](https://docs.ohif.org/user-guide/viewer/viewport/), [OHIF metadata requirements](https://docs.ohif.org/faq/technical/). Chốt phiên bản ổn định cùng bộ loader/tools ngày 1; không phối API thử nghiệm với package khác version.
