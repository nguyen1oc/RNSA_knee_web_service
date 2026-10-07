# 16 — P1: Native DICOM và MPR

> **Cập nhật gần nhất:** 2026-10-07
> **Thay đổi gần nhất:** Overview có selector `MPR source`; gizmo mini-orbit ba vòng màu ở góc dưới-phải MRI Volume.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Phạm vi

UI tiếng Anh, theme sáng, viewport đen. Không auth, AI, Triton hoặc GCP. Chỉ chạy trên localhost với dữ liệu nghiên cứu đã khử định danh. Đây chưa phải thiết bị/phần mềm chẩn đoán được kiểm định.

| Màn hình | Dữ liệu và hành vi |
|---|---|
| Overview | 3D MRI volume + axial/sagittal/coronal MPR được dựng từ **cùng một** series. Crosshair và vị trí slice đồng bộ trong volume; không ghép các acquisition khác nhau. Nếu geometry không đạt gate, báo lỗi và dùng các tab hướng/Series để xem ảnh gốc. |
| Sagittal / Coronal / Axial | Stack gốc của acquisition đang chọn; Layout 1×1, 2×2 hoặc custom tối đa 4×4. Mỗi card giữ slice/camera riêng. |
| Sagittal / Coronal / Axial | Stack gốc của acquisition theo hướng đó; đây không phải các mặt phẳng tái tạo của Overview. |
| Images / Series | Inventory acquisition và metadata; thumbnail PNG vẫn chỉ là preview. |
| Overview layouts | `3D four-up` là lưới 2×2; `3D primary` ưu tiên MRI volume lớn bên trái; `3D main` cho volume trải ngang phía trên và ba mặt phẳng ở dưới. Cả ba giữ nguyên cùng bốn viewport, chỉ đổi bố cục. |
| MRI volume 3D | Volume ray-cast dựng từ voxel DICOM của **MPR source** đang chọn; cả ba plane màu cùng lấy từ volume đó. Gizmo nền đen chỉ nằm trong viewport này: ba vòng orbit mảnh, đỏ (axial) kéo trái/phải, vàng (sagittal) kéo lên/xuống, xanh lá (coronal) kéo xiên. Kéo vòng để xoay quanh trục tương ứng; kéo nền vẫn xoay tự do. Camera không làm đổi vị trí hay orientation các mặt phẳng MPR. Đây là intensity rendering, không phải model anatomy chung, surface mesh, segmentation hay phát hiện tổn thương. Model GLB tham khảo không còn nằm trên Overview chính. |
| Study information | Hiện đủ Study UID theo nhiều dòng. `Incompatible frames` nghĩa là series có Frame of Reference UID khác nhau nên không thể căn chỉnh/overlay chéo series an toàn. Điều này không tự động vô hiệu MPR; MPR được kiểm tra riêng từng series. |

Không cần ba acquisition gốc cùng FrameOfReferenceUID để tạo MPR. Điều kiện cùng FrameOfReferenceUID áp dụng giữa các lát **trong series được dựng volume**. FS/fluid/fat vẫn là đặc điểm acquisition, không phải hiệu ứng bật/tắt để biến đổi một sequence sang sequence khác. Trên MRI, T2/PD fluid-sensitive thường làm dịch/phù sáng; FS (fat suppression) làm tín hiệu mỡ tối đi. FS không có nghĩa là “chế độ xem chất lỏng”; cần đọc metadata sequence, không tự suy luận chỉ từ ảnh.

## Tương tác

- Pointer / pan là mặc định. Chọn card trước khi thao tác.
- Wheel: xuống = slice kế tiếp, lên = trước; chặn wheel lan sang trang ở vùng ảnh. Một yêu cầu decode tại một thời điểm, wheel được giới hạn nhịp 120 ms.
- Thanh slice dọc sát phải, đầu trên = slice đầu. Chỉ active card nhận thao tác; không nhận yêu cầu mới khi đang tải ảnh.
- Zoom bằng nút +/−, Ctrl+wheel hoặc right-drag; min = fit 100%, không đặt trần zoom hữu hạn trong UI. Reset đưa camera/pan và VOI về mặc định.
- Window / Level: chọn tool rồi kéo trên ảnh. Window width đặt dải cường độ/contrast; window level dịch tâm dải để chỉnh độ sáng. W/L hiển thị bằng giá trị VOI thực, không dùng CSS brightness/contrast.
- 3D volume: Cornerstone ray-cast viewport đọc cùng voxel volume với ba mặt MPR. Ba plane màu được tính từ focal point + normal mỗi MPR viewport, giao với bounds DICOM trong world coordinates, rồi chiếu lên camera 3D; không dùng index slice giả định chung giữa các hướng. Chọn plane rồi kéo theo trục chiếu màn hình rõ nhất để đổi lát; bước mỗi slice tối thiểu 8 CSS px để giảm nhảy nhanh khi plane gần edge-on. Normal để xác định chiều lấy trực tiếp từ `getVolumeViewportScrollInfo` của đúng viewport. Wheel cũng đổi slice đang chọn. Gizmo mini-orbit nền đen ở góc dưới-phải MRI Volume có ba vòng: đỏ/axial xoay trái-phải, vàng/sagittal xoay lên-xuống, xanh lá/coronal xoay xiên. Kéo vòng để xoay camera quanh trục tương ứng; kéo nền xoay tự do, right-drag zoom, `Reset` trả camera về mặc định. Gizmo không xuất hiện trên ba viewport MPR và camera không làm đổi vị trí slice. `Standard MR` và `Angio-style (experimental)` là transfer/display appearance, không phải filter FS hay AI; Angio-style không biến đầu gối thành ảnh mạch máu. `Composite` và `Maximum intensity (MIP)` là projection mode riêng; MIP thật bật chế độ maximum-intensity blend. MRI intensity không đặc hiệu mô.
- Length/Rectangle ROI/Ellipse ROI/Freehand ROI dùng Cornerstone tools và tọa độ ảnh. Đơn vị vật lý chỉ có ý nghĩa khi metadata spacing hợp lệ; phải kiểm chuẩn với phantom/reference trước dùng lâm sàng.
- Arrow + note: vẽ rồi nhập text inline, double-click sửa text. Nút Eraser riêng xóa mark được click; menu phụ có `Clear all marks on this slice` kèm bước xác nhận. Annotation là state browser-session, không persist server hay DICOM SR.
- Capture trong tab hướng: preview cập nhật theo PNG/JPEG, kích thước vuông 512×512 / 256×256 / 128×128 px, annotation và metadata; chỉ tải sau khi người dùng xác nhận. Ảnh MRI được fit vào khung vuông, giữ aspect ratio, không crop/stretch. Capture viewport đã render nên giữ W/L, pan, zoom; không thay pixel DICOM gốc.
- Overview/MPR: chọn một series tại `MPR source` → cả volume và ba mặt phẳng được dựng lại từ series đó sau geometry check. Mặc định ưu tiên series metadata geometry hợp lệ; nếu ngang nhau ưu tiên sagittal rồi số lát nhiều hơn. Đây chỉ là heuristic ban đầu, không thay thế eligibility gate của volume. Chọn nguồn không ghép các acquisition; direction tabs vẫn mở stack gốc. Crosshair liên kết ba mặt phẳng; layout chỉ đổi bố cục. Kéo một trong ba orbit ring để xoay camera theo trục màu đó; kéo nền volume xoay tự do. Pan/WL là chế độ khác, right-drag zoom. Không rotation/slab-thickness controls trong P1.

## Luồng kỹ thuật

```text
Upload / example → SQLite index → /series/{id}/slices
                                  ├─ /instances/{id}/dicom → worker decode → native stack → tools / capture
                                  └─ /series/{id}/volume → geometry gate
                                                          ├─ reject + lý do → vẫn xem stack
                                                          └─ load same volume → 3 orthographic MPR + 1 rotatable 3D volume viewport
```

Geometry gate kiểm tra >=3 single-frame grayscale slices; IOP/IPP/PixelSpacing finite và nhất quán; cosine đơn vị/vuông góc; không trùng vị trí, gap bất thường hay displacement trong mặt phẳng; cùng series/frame/dimensions/pixel format. Tolerance: IOP/spacing 0.001, gap max(0.01 mm, 1%), displacement 0.05 mm. Budget conservative: 384 MiB khi ước lượng 4 byte/voxel; cache decoded 512 MiB; 2 decode workers, 3 preload tasks. Đây không phải giới hạn tổng RAM/GPU cứng của browser.

MPR hủy phần load chưa bắt đầu khi đổi series/tab, dispose engine/toolgroup/volume khi unmount. Lỗi decode/WebGL phải hiển thị rõ, không thay bằng ảnh PNG và gọi đó là native. Series lát dày được cảnh báo anisotropic; nội suy không tạo thêm thông tin giải phẫu. Rendering chạy client-side qua WebGL/GPU trình duyệt khi khả dụng; chưa có Triton/checkpoint/GCP. 3D/MPR vẫn giới hạn một series qua geometry gate, không ghép sequence hoặc Frame of Reference khác nhau.

## Module

- `frontend/src/imaging/runtime.js`: init core/loader/tools, registration, tool binding.
- `imaging/volume.js`: geometry request, bounded preloading và volume lifecycle.
- `imaging/capture.js`: canvas + annotation SVG export.
- `components/NativeViewport.jsx`: một native stack/card.
- `FocusedViewer`, `OverviewGrid`, `LayoutPicker`, `NativeToolPicker`, `MprViewer`: layout và controls.
- `backend/volume_geometry.py`: pure geometry gate, test synthetic độc lập dữ liệu thật.

## Kiểm tra và hạn chế

- Backend pytest: 24 cases gồm import/delete P0, byte-exact DICOM endpoint, eligible volume, oblique/reversed order, 13 nhóm geometry lỗi, stack quá ngắn.
- Ruff/Mypy và production frontend build phải pass. Docker/CI dùng Node 24 do codec dependency yêu cầu >=24.
- Manual gate: đối chiếu native ảnh đầu/giữa/cuối với reference viewer; MONOCHROME1, signed pixels, rescale, compressed syntaxes phải có fixture riêng trước tuyên bố hỗ trợ đầy đủ.
- Manual geometry gate: phantom có tọa độ biết trước cho crosshair, physical distances/area, oblique stack và anisotropic data. Kiểm tra kéo/cuộn plane 3D đổi đúng lát MPR và camera rotation không làm lệch world position. Chưa có xác nhận độ chính xác lâm sàng.
- Multi-frame chưa có frame-level indexing nên ngoài phạm vi. MPR không trộn FS/non-FS/echo khác nhau.
- `npm audit --omit=dev` hiện báo dependency gián tiếp trong Cornerstone/VTK/dcmjs (adm-zip, fflate, uuid). Không chạy `audit fix --force` để downgrade/bẻ API. Cần xử lý và đánh giá reachability trước public deployment; runtime ZIP upload hiện ở Python, không qua adm-zip browser.
- Chưa lưu annotation lâu dài, chưa DICOM SR, chưa segmentation/surface mesh hay chuyển camera 3D thành orientation mới cho MPR. Intensity rendering không phải phân tích chẩn đoán và chưa được xác nhận lâm sàng.
