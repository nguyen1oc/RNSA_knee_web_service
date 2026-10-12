# 06 — Model contract và Triton

> **Cập nhật gần nhất:** 2026-10-13
> **Thay đổi gần nhất:** Workflow mới nhất truyền cấu hình Triton cho cả staging và production; ngày 13/10, API production health `ok` và Triton production `Ready`, nhận 100% traffic. Điều này chưa thay thế lượt Analyze end-to-end trên production. Xem [21 — tài liệu bàn giao](21-project-handover.md).
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

> Các mục ghi “kế hoạch” bên dưới là ghi chú từ giai đoạn thiết kế. Trạng thái triển khai hiện tại nằm trong tài liệu 20 và 21; không làm theo các mốc sprint cũ như thể chúng vẫn chưa hoàn thành.

## Trạng thái contract

Checkpoint Fold 0, epoch 13 đang được dùng cho serving: ImageNet ResNet-34 với gated-attention pooling có mask, bốn slot được chọn theo geometry và 12 target theo thứ tự bên dưới. Nút Analyze gọi `POST /api/studies/{study_id}/analyze`. Backend lấy DICOM đã lưu, tạo tensor theo pipeline dùng chung, rồi chạy local runner hoặc gọi Triton tùy cấu hình môi trường. Người dùng upload DICOM/ZIP/folder; trình duyệt không gửi checkpoint hay tensor.

Slot thiếu được loại khỏi gated-attention pooling bằng `slot_mask`; đây là hành vi đã được chọn cho checkpoint hiện tại. Scores chưa được calibration và không phải kết luận chẩn đoán. Giao diện giữ kết quả theo study trong `sessionStorage` của tab; không nên hiểu điều này là kết quả đã được lưu lâu dài vào Firestore.

Contract mẫu ở [model-contract template](templates/model-contract.template.json) hữu ích khi thay checkpoint hoặc thay preprocessing. Trước khi đổi model, cập nhật template, kiểm tra output order và chạy lại parity test. Không dùng các phân công Người 1/Người 2 trong kế hoạch cũ làm phân công hiện tại.

Thông tin phải có: checkpoint digest, architecture, class order, slot order/rules, candidate selection, missing-mask semantics, slice sampling, orientation, crop/pad, rescale/normalization, dtype/shape, fold aggregation, output semantics, preprocessing version.

## Runner local — 2026-10-12

Thư mục `knee-web/backend/ai/` có runner dòng lệnh để kiểm tra inference độc lập với web API và Triton. Chạy lệnh từ thư mục `knee-web`:

```powershell
.\.venv\Scripts\python.exe -m backend.ai `
  --input ..\dicom-viewer\files\results.zip `
  --checkpoint .\fold_00_best.zip `
  --device cuda
```

The runner safely extracts only `.dcm` members to a temporary directory, caps inputs at 500 DICOMs/800 MiB expanded, groups one Study UID, ranks candidate series by DICOM geometry, applies the A2 inference preprocessing, loads the checkpoint with `weights_only=True` and strict state-dict matching, then returns sigmoid outputs in frozen target order. Optional `--series-metadata <test_series.csv>` uses official `Anatomical_Plane`, `Fat_Suppression`, and `Fluid_Sensitive` columns; without it, header-derived classification is heuristic.

The local runner follows the supplied A2 inference notebook's all-slice geometry score. The A2 training notebook computes its geometry score from three representative headers. Both are geometry-ranked, but a multi-candidate study must compare selected Series UIDs between train-cache and inference logic before claiming exact parity.

Offline verification: checkpoint SHA-256 `61cdcea1ae8c0377c37495c9fc1f43bbcbff632b4168636440d41d2e4e39f47c`, epoch 13, strict ResNet-34/gated-attention load passed on CUDA. Sample Study UID ending `10047035057544427318018579121635276191` produced shape `[1, 12]` and finite outputs. Header heuristics selected `SAG_NOFS`, `COR_FS`, and `AX_FS`; `SAG_FS` was absent and masked. The local `train_series.csv` has no authoritative metadata row for this test study, so this run verifies end-to-end mechanics—not model quality, official series classification, calibration, or clinical validity. Scores are uncalibrated sigmoid model scores.

Ở local, API cần `AI_CHECKPOINT_PATH` trỏ tới checkpoint đọc được; `AI_DEVICE` chọn `cuda`, `cpu` hoặc `auto`. Checkpoint không nằm trong Git hay Docker image. Trên Cloud Run, API gọi Triton khi có `TRITON_URL`; xem cấu hình và giới hạn ở [20 — Triton trên Cloud Run GPU](20-triton-cloudrun-gpu.md). Thay đổi series selection hoặc tensor preprocessing cần chạy lại so sánh với notebook và Triton trên các study đại diện.

## Cách serving hiện tại và nguyên tắc vận hành

Triton Python backend bọc model PyTorch hiện có. Image, Triton và thư viện PyTorch/torchvision được pin phiên bản; dependency phải có sẵn trong image, không cài package trong lúc nhận request.

FastAPI xử lý DICOM và tạo tensor; Triton chỉ nhận tensor cùng các mask theo contract. Triton nạp checkpoint khi khởi động service, không nạp lại ở mỗi request. Cấu hình hiện dùng batch 1 và một model instance; chưa bật dynamic batching. Chỉ đổi concurrency/batching sau khi đã kiểm tra code model, GPU memory và kết quả tải.

Python backend cần kiểm tra shared memory và RAM/VRAM cho số instance dự kiến. Dùng runtime dependency đúng với interpreter của backend. Nguồn: [NVIDIA Python backend](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/python_backend/README.html).

## Pipeline và tính tương đương

1. Freeze inventory và chọn series theo đúng training/inference rules.
2. Decode pixel đúng transfer syntax/rescale; xử lý orientation/order như notebook chuẩn.
3. Lấy slice, crop theo spacing, padding, resize, normalization và channels đúng cấu hình.
4. Tạo mask/shape; lưu SOP/frame đã dùng vào snapshot.
5. Gọi model, aggregate folds theo quy tắc đã xác nhận, map class order.
6. Lưu score gốc + phiên bản + cảnh báo; không threshold theo giá trị tự nghĩ ra.

Missing slot: chỉ zero-fill + mask nếu model đã được train/kiểm chứng cách đó. Nếu không, reject hoặc áp dụng quy tắc được xác nhận. Candidate nhiều: phải có lựa chọn deterministic, giữ lý do và danh sách thay thế. Unknown FS/fluid không tự coi là false.

Đọc toàn study trong viewer; số slice model sample có thể nhỏ hơn và độc lập với slice bác sĩ đang xem. Không dùng ảnh đã W-L, screenshot, crop do người dùng zoom hoặc JPEG thumbnail làm input thay pipeline gốc.

## Giới hạn khi dùng một checkpoint

Web serving hiện dùng checkpoint Fold 0; không tự suy ra đây là ensemble nhiều fold. Nếu sau này dùng nhiều checkpoint hoặc đổi cách gộp scores, cần xác định rõ thuật toán, ghi phiên bản và đánh giá lại. Không thay rank aggregation bằng mean score/logit rồi gọi là tương đương nếu chưa kiểm chứng.

## Output cho UI

MVP chỉ score cấp study và các warning, trừ khi checkpoint chứng minh output khác. Không chuyển attention thành vùng tổn thương ground truth. Không thêm bounding box/segmentation nếu không có model tương ứng. Hiển thị model_score chưa calibration; threshold và clinical labels để null cho đến khi có xác nhận.

## Kiểm thử trước khi phát hành model mới

- Ít nhất 5 fixture được giữ cố định, bao gồm ca thiếu/multiple candidate nếu model hỗ trợ.
- So selected series, SOP/frame order, mask, tensor shape; so giá trị tensor và score với offline reference theo tolerance ghi trong report.
- Tolerance xác định trước khi nghiệm thu theo dtype/device; điểm khởi đầu FP32 là atol=1e-5, rtol=1e-4, cần kiểm chứng chứ không bảo đảm mọi pipeline đạt.
- Repeated same input cùng version cho kết quả trong tolerance; lỗi NaN/Inf/class-order mismatch phải fail.
- Đo cold load, warm infer, peak VRAM/RAM; thử một request lỗi không làm hỏng request tiếp theo.
- Model ready khác server live: UI không báo “sẵn sàng AI” khi checkpoint chưa load xong.

Tối ưu precision/ONNX/TensorRT sau baseline parity; thay precision phải chạy lại parity và ghi version.
