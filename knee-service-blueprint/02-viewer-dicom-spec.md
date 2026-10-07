# 02 — Viewer và DICOM

> **Cập nhật gần nhất:** 2026-10-07
> **Thay đổi gần nhất:** Selector Overview là `MPR source`; một nguồn tạo cả ba MPR và volume, với geometry gate riêng.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

> Phạm vi cập nhật 07/10/2026: chỉ DICOM `.dcm` cho local viewer. Nút Analyze có mặt để giữ workflow nhưng chỉ báo “coming soon”; chưa có AI panel/model. Single-series MPR và intensity-based rotatable 3D volume đã có; segmentation/surface mesh còn deferred. Các mô tả PNG/CSS bên dưới giữ làm lịch sử P0 và không thay thế doc 16. Seed và input theo [13](13-input-formats-and-example-studies.md).

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
| Overview | Bốn viewport MPR đồng bộ từ một series hợp lệ: MRI volume 3D + axial/coronal/sagittal; slice/crosshair biểu diễn cùng tọa độ trong volume. Có layout 3D four-up / primary / main. |
| Sagittal / Coronal / Axial | Hướng được chọn trở thành focused viewer; Layout dropdown có preset `1x1/2x2` và custom grid tối đa `4x4` hiển thị nhiều lát của cùng series |
| Images / Series | Browser các acquisition/series với lát đại diện và metadata; chọn một series rồi chuyển sang tab hướng để đọc chi tiết |
| Stack / Series | Một stack cho DICOM chưa xác định hướng; không ép vào ba hướng |
| Series gốc | Tab theo hướng và Images / Series duyệt acquisition gốc; các series không được ghép ngầm vào volume MPR. |

Sidebar dùng tree: Study row → Series row → danh sách ngắn các filename slice khi expand. Mỗi series vẫn có thumbnail/description, hướng, FS, fluid-sensitive, số frame và trạng thái load. Không liệt kê hàng nghìn tên DICOM mặc định; chỉ hiện vài filename đại diện và tổng số slice. Không có badge “AI đang dùng” hoặc score trong phase local; Analyze chỉ là CTA placeholder.

Focused direction hiện có một Layout dropdown: chọn nhanh `1x1`/`2x2`, hoặc rê chuột trên bảng border `4x4` để preview vùng `1x1`–`4x4` rồi click để áp dụng. Mỗi viewport cùng series có rail slice dọc ở mép phải ảnh, zoom/reset/pan riêng và `Sync slices` tùy chọn; footer giữ tên series và chỉ số `current / total` để không che rail. Khi focused view mở series mới, các viewport bắt đầu từ slice 1 và tăng dần theo từng ô, không nhảy mặc định vào slice giữa. Wheel trên viewport active đổi lát (`scroll down = next`, `scroll up = previous`) và chặn scroll lan ra trang; rail là cách kéo chính để scrub, có min ở trên cùng và max ở dưới cùng. Zoom dùng nút trong từng viewport hoặc toolbar của viewport active; mức thấp nhất là fit 100%, không đặt max nhân tạo. Tool được gom vào một dropdown, mặc định Pointer; Pointer dùng để chọn viewport, đổi slice và pan sau khi zoom. Các tool vẽ gồm Length, Rectangle, Ellipse, Freehand và Arrow + note. Length/shape hiện px nếu chưa có calibration, hoặc mm/dimension khi PixelSpacing hợp lệ. Arrow + note mở inline editor sau khi kéo mũi tên. Nút Eraser riêng xóa một mark được click; `Clear all marks on this slice` ở menu phụ yêu cầu xác nhận. Các mark chỉ gắn với slice hiện tại để không trôi sang lát khác. Capture xuất viewport active thành PNG/JPEG với lựa chọn kích thước, include annotations và include slice/orientation metadata.

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
| Chọn series ở Overview | Selector `MPR source` chọn một acquisition duy nhất làm nguồn volume cho cả ba mặt phẳng và 3D; đổi nguồn sẽ dựng lại đồng bộ sau geometry check. Mặc định ưu tiên geometry metadata hợp lệ, rồi sagittal, rồi stack nhiều lát; eligibility vẫn phải do volume gate xác nhận. |
| Overview MPR controls | Ba mặt phẳng dùng cùng series/volume và crosshair; chọn một plane rồi wheel/drag để di chuyển vị trí; camera 3D chỉ xoay volume |
| Slice rail dọc | Dùng thanh slider bên phải từng viewport để chọn slice; slider bị khóa trong lúc ảnh kế tiếp đang load; khi rail/viewport active nhận thao tác thì body scroll bị khóa; số ở footer và nhãn rail dùng chỉ số 1-based |
| Previous / Next Slice | Chỉ lướt stack của viewport được chọn; click card khác trước để đổi active, không chuyển tab; focused view mới bắt đầu từ slice 1 |
| Wheel trong focused viewport | Đổi slice của viewport active; lướt xuống sang slice kế tiếp, lướt lên về slice trước; không đổi zoom |
| Zoom controls | Zoom viewport từ 100% (fit mặc định) trở lên quanh tâm viewport; Zoom out không nhỏ hơn fit, Zoom in không có max nhân tạo; Reset đưa về fit |
| Pointer mặc định | Chọn viewport, wheel/rail để đổi slice; pan ảnh khi đang zoom; viewport giữ overflow hidden có chủ đích để ảnh di chuyển dưới khung đọc |
| Toolbar Zoom / Pan / W-L + kéo chuột | Công cụ tường minh; keyboard vẫn dùng được |
| Contrast / Brightness / Invert preview | Điều chỉnh khả năng đọc ảnh trong local UI; reset được; không sửa DICOM |
| Double-click | Không đổi tab; dùng `Open` để chuyển direction |
| Open trên image card | Chuyển sang tab Sagittal/Coronal/Axial tương ứng với series của card |
| Reset view trên card / Reset toolbar | Reset zoom, pan và fit về mặc định trước khi zoom, không đổi input AI |
| Crosshair MPR | Chỉ bật khi volume của series đang chọn đã validate; cập nhật ba mặt phẳng cùng volume. Không yêu cầu các series khác trong study phải cùng frame; không bật cross-series overlay giả |
| Link toggle | Mặc định tắt giữa các series; chọn sync vị trí/zoom/W-L riêng |

| Multi-view layout | Mở một Layout dropdown, chọn `1x1`, `2x2` hoặc hover/click vùng trong bảng 4×4 để chọn `1x1`–`4x4`; mỗi viewport có rail dọc và zoom/reset riêng; `Sync slices` đưa các viewport về cùng index |
| Preview measurement | Dropdown mặc định Pointer, có Length/Rectangle/Ellipse/Freehand/Arrow + note; Length và shape hiện số đo px hoặc mm nếu có PixelSpacing; Eraser xóa mark đơn; clear-all là menu phụ có xác nhận; gắn với viewport + slice hiện tại, không sửa pixel nguồn |
| Capture | Preview trước khi tải PNG/JPEG; chọn ảnh vuông 512×512, 256×256 hoặc 128×128; ảnh được contain, không crop/stretch; có thể kèm overlay và slice/orientation metadata |

State theo study + series + viewport: SOP/frame, camera, zoom, pan, window/level, inversion và slice position. Overview dùng một volume nguồn; crosshair và ba mặt phẳng MPR đồng bộ theo tọa độ, còn camera 3D xoay độc lập. Direction tabs mở acquisition gốc và focused direction có layout nhiều viewport cùng hướng. Đổi tab rồi quay lại giữ state trong phiên. Persist layout/annotation tuỳ chọn, không cần persist toàn bộ camera trong MVP.

## Window/level và 3D

Spec đích có hai thanh Window width (>0) và Window level; kèm số, reset và DICOM-default/auto preset. Vertical slice hiện tại dùng Contrast/Brightness/Invert preview để cải thiện ảnh PNG render từ backend; đây chưa phải DICOM W/L calibration. Auto preset tương lai phải tính trên mẫu series đã xác định, không auto-normalize từng slice làm nhấp nháy khi scroll. Giữ đầy đủ bit depth và rescale theo DICOM/loader; MONOCHROME1 inversion đúng.

FS/fluid là filter/badge để chọn acquisition; không có toggle biến non-FS thành FS. W-L, opacity và zoom không sửa pixel nguồn hoặc tensor inference.

Ô 3D có mặt phẳng cắt với tên hướng; kéo mặt phẳng để đổi vị trí. Picking một điểm trong khối bán trong suốt phải có quy ước độ sâu riêng nên để P2. Volume rendering không mặc định tạo mô hình giải phẫu đã phân đoạn.

### Cấu hình ô 3D và mô hình tải sẵn

MVP đề xuất là **định vị không gian từ dữ liệu DICOM của study**, chưa phải một mesh khớp gối tách xương/sụn. Dựng khung thể tích và các mặt phẳng ảnh theo IPP/IOP/spacing; xoay/zoom khung nhìn và kéo mặt phẳng để chọn lát. Ở overview native, mỗi series chỉ nối tới hệ tọa độ chung khi geometry/frame of reference tương thích; ngoài trường hợp đó không giả đồng bộ.

Trong Overview, chọn một series phù hợp; cùng volume DICOM cấp cho ba mặt phẳng orthographic và viewport 3D có thể xoay camera. Volume appearance dùng `Standard MR` hoặc `Angio-style (experimental)`; projection chọn riêng `Composite` hoặc maximum intensity projection (MIP). Không dùng CT-Bone. Kết quả phụ thuộc sequence, cường độ và geometry; không tương đương mesh/segmentation và không hứa hiển thị giải phẫu/xương có độ chính xác chẩn đoán. Camera 3D xoay độc lập, không reorient ba slice MPR.

Model giải phẫu 3D tải sẵn (GLB/glTF) chỉ dùng làm hình minh họa/định hướng chung, phải ghi “Giải phẫu tham khảo”; kiểm tra license và attribution. Không đại diện anatomy của bệnh nhân và không có mapping chính xác click → slice nếu chưa registration. Không cần tải asset này để làm MPR hoặc khung định vị từ DICOM.

Muốn mesh xương/sụn đúng bệnh nhân: cần segmentation MRI → mask → surface mesh; đây là pipeline riêng, ngoài MVP hiện tại. Model phân loại bệnh trên Triton không tự sinh mesh hay segmentation.

Nền chrome dùng theme sáng theo design system; vùng chứa MRI dùng màu đen để khớp pixel ảnh và giảm cảm giác ảnh bị đặt trong khung trắng. Điều này không invert ảnh, xóa background tối trong pixel hoặc đổi normalization AI.

## Trạng thái bắt buộc

Empty, uploading, indexing, loading/decode, ready, partial, unsupported codec/frame, missing geometry, memory limit, failed. Phân biệt “không có series” với “chưa index/nạp xong”. Ô lỗi có nguyên nhân, retry/chọn series khác; không hiển thị ảnh cũ dưới tên series mới.

Nguồn kỹ thuật: [Cornerstone viewports](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/viewports/), [OHIF viewport](https://docs.ohif.org/user-guide/viewer/viewport/), [OHIF metadata requirements](https://docs.ohif.org/faq/technical/). Chốt phiên bản ổn định cùng bộ loader/tools ngày 1; không phối API thử nghiệm với package khác version.
