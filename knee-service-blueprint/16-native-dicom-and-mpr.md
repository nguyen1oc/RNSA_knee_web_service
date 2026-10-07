# 16 — P1: Native DICOM và MPR

> **Cập nhật gần nhất:** 2026-10-07
> **Thay đổi gần nhất:** Cho phép drag crosshair và cập nhật branch workflow dev/main.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Phạm vi

UI tiếng Anh, theme sáng, viewport đen. Không auth, AI, Triton hoặc GCP. Chỉ chạy trên localhost với dữ liệu nghiên cứu đã khử định danh. Đây chưa phải thiết bị/phần mềm chẩn đoán được kiểm định.

| Màn hình | Dữ liệu và hành vi |
|---|---|
| Overview | Các acquisition SAG/COR/AX độc lập. Click chọn card, Open mới sang tab hướng. Không crosshair giữa những series chưa đăng ký không gian. |
| Sagittal / Coronal / Axial | Stack gốc của acquisition đang chọn; Layout 1×1, 2×2 hoặc custom tối đa 4×4. Mỗi card giữ slice/camera riêng. |
| MPR | Tái tạo axial/sagittal/coronal từ **một** series có geometry hợp lệ; crosshair liên kết tọa độ ba mặt phẳng. |
| Images / Series | Inventory acquisition và metadata; thumbnail PNG vẫn chỉ là preview. |
| 3D locator | Minh họa hướng, không có anatomy bệnh nhân. Volume rendering 3D và segmentation thuộc phase tiếp theo. |

Không cần ba acquisition gốc cùng FrameOfReferenceUID để tạo MPR. Điều kiện cùng FrameOfReferenceUID áp dụng giữa các lát **trong series được dựng volume**. FS/fluid/fat vẫn là đặc điểm acquisition, không phải hiệu ứng bật/tắt để biến đổi một sequence sang sequence khác.

## Tương tác

- Pointer / pan là mặc định. Chọn card trước khi thao tác.
- Wheel: xuống = slice kế tiếp, lên = trước; chặn wheel lan sang trang ở vùng ảnh. Một yêu cầu decode tại một thời điểm, wheel được giới hạn nhịp 120 ms.
- Thanh slice dọc sát phải, đầu trên = slice đầu. Chỉ active card nhận thao tác; không nhận yêu cầu mới khi đang tải ảnh.
- Zoom bằng nút +/−, Ctrl+wheel hoặc right-drag; min = fit 100%, không đặt trần zoom hữu hạn trong UI. Reset đưa camera/pan và VOI về mặc định.
- Window / Level: chọn tool rồi kéo trên ảnh. W/L hiển thị bằng giá trị VOI thực, không dùng CSS brightness/contrast.
- Length/Rectangle ROI/Ellipse ROI/Freehand ROI dùng Cornerstone tools và tọa độ ảnh. Đơn vị vật lý chỉ có ý nghĩa khi metadata spacing hợp lệ; phải kiểm chuẩn với phantom/reference trước dùng lâm sàng.
- Arrow + note: vẽ rồi nhập text inline, double-click sửa text. Eraser xóa một mark; Clear slice marks xóa các mark trên slice hiện tại. Annotation là state browser-session, không persist server hay DICOM SR.
- Capture trong tab hướng: PNG/JPEG, native/1024/2048/custom 1600 px, tùy chọn annotation/metadata. Chụp viewport đã render nên giữ W/L, pan, zoom; không thay pixel DICOM gốc.
- MPR: chọn series ở Active series → MPR → chờ load → Crosshair. Bấm/di chuyển giao điểm làm hai mặt phẳng còn lại đi tới cùng vị trí. Pan/WL là chế độ khác, right-drag zoom. Không rotation/slab-thickness controls trong P1.

## Luồng kỹ thuật

```text
Upload / example → SQLite index → /series/{id}/slices
                                  ├─ /instances/{id}/dicom → worker decode → native stack → tools / capture
                                  └─ /series/{id}/volume → geometry gate
                                                          ├─ reject + lý do → vẫn xem stack
                                                          └─ load volume → 3 orthographic viewports → crosshair
```

Geometry gate kiểm tra >=3 single-frame grayscale slices; IOP/IPP/PixelSpacing finite và nhất quán; cosine đơn vị/vuông góc; không trùng vị trí, gap bất thường hay displacement trong mặt phẳng; cùng series/frame/dimensions/pixel format. Tolerance: IOP/spacing 0.001, gap max(0.01 mm, 1%), displacement 0.05 mm. Budget conservative: 384 MiB khi ước lượng 4 byte/voxel; cache decoded 512 MiB; 2 decode workers, 3 preload tasks. Đây không phải giới hạn tổng RAM/GPU cứng của browser.

MPR hủy phần load chưa bắt đầu khi đổi series/tab, dispose engine/toolgroup/volume khi unmount. Lỗi decode/WebGL phải hiển thị rõ, không thay bằng ảnh PNG và gọi đó là native. Series lát dày được cảnh báo anisotropic; nội suy không tạo thêm thông tin giải phẫu.

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
- Manual geometry gate: phantom có tọa độ biết trước cho crosshair, physical distances/area, oblique stack và anisotropic data. Chưa có xác nhận độ chính xác lâm sàng.
- Multi-frame chưa có frame-level indexing nên ngoài phạm vi. MPR không trộn FS/non-FS/echo khác nhau.
- `npm audit --omit=dev` hiện báo dependency gián tiếp trong Cornerstone/VTK/dcmjs (adm-zip, fflate, uuid). Không chạy `audit fix --force` để downgrade/bẻ API. Cần xử lý và đánh giá reachability trước public deployment; runtime ZIP upload hiện ở Python, không qua adm-zip browser.
- Chưa lưu annotation lâu dài, chưa DICOM SR, chưa patient-specific 3D rendering. Những mục này không được gọi là hoàn thành P1.
