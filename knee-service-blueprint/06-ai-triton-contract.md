# 06 — Model contract và Triton

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Chuẩn hóa metadata tài liệu; phase AI/Triton vẫn được đánh dấu deferred.  
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

> **Hoãn từ 05/10/2026:** tài liệu cho phase AI sau local viewer. “Ngày 1–2”, “MVP” và các gate dưới đây chỉ áp dụng khi bắt đầu sprint AI; không chặn upload/viewer/examples. Phân biệt NVIDIA Triton Inference Server với Triton language và vị trí GPU/checkpoint ở [12, mục 6](12-local-docker-build-steps.md#6-triton-nào-checkpoint-đặt-đâu-gpu-từ-đâu).

## Gate ngày 1 của phase AI

Chưa chốt checkpoint. Workspace có schema sáu slot viewer, recovered sáu slot và nhiều model bốn slot. Không chọn thay người dùng bằng cách lấy notebook đầu tiên tìm thấy.

Người 2 điền [model contract](templates/model-contract.template.json), chạy offline trên fixture và dùng `/models` để dựng input panel; Người 1 review contract để implement snapshot/job orchestration. Các trường null/TBD trong template là blocker trước bật nút inference thật.

Thông tin phải có: checkpoint digest, architecture, class order, slot order/rules, candidate selection, missing-mask semantics, slice sampling, orientation, crop/pad, rescale/normalization, dtype/shape, fold aggregation, output semantics, preprocessing version.

## Đường triển khai khuyến nghị

Đầu sprint cân nhắc **Triton Python backend** để bọc inference PyTorch hiện có, giữ pipeline đúng trước khi tối ưu. Không bắt buộc export ONNX/TensorRT trong hai tuần. Pin image/backend/PyTorch/CUDA tương thích, cài dependency vào image riêng; không pip install lúc nhận request.

Worker xử lý DICOM và tạo tensor; Triton nhận tensor + mask theo contract. Model load một lần ở initialize, execute xử lý request. Không load checkpoint ở mỗi request. Batch 1 và một model instance trước; chỉ bật dynamic batching khi shape/mask và code thực sự hỗ trợ và đã test.

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

## Điểm cần xử lý riêng: rank averaging

README inference hiện có fold rank averaging. Ranking trong tập test phụ thuộc các ca cùng tập, không tự chuyển thành score ổn định cho từng bệnh nhân riêng lẻ.

Ngày 1–2 phải xác minh code và chọn quy tắc phục vụ từng study; ví dụ mean score/logit chỉ là ứng viên, không mặc định tương đương ranking. Mọi thay đổi aggregation phải được ghi version và đánh giá lại; không gọi “khớp notebook” khi đã đổi thuật toán. Nếu chưa giải quyết, demo inference đánh dấu blocked, không giả score.

## Output cho UI

MVP chỉ score cấp study và các warning, trừ khi checkpoint chứng minh output khác. Không chuyển attention thành vùng tổn thương ground truth. Không thêm bounding box/segmentation nếu không có model tương ứng. Hiển thị model_score chưa calibration; threshold và clinical labels để null cho đến khi có xác nhận.

## Kiểm thử bắt buộc

- Ít nhất 5 fixture được giữ cố định, bao gồm ca thiếu/multiple candidate nếu model hỗ trợ.
- So selected series, SOP/frame order, mask, tensor shape; so giá trị tensor và score với offline reference theo tolerance ghi trong report.
- Tolerance xác định trước khi nghiệm thu theo dtype/device; điểm khởi đầu FP32 là atol=1e-5, rtol=1e-4, cần kiểm chứng chứ không bảo đảm mọi pipeline đạt.
- Repeated same input cùng version cho kết quả trong tolerance; lỗi NaN/Inf/class-order mismatch phải fail.
- Đo cold load, warm infer, peak VRAM/RAM; thử một request lỗi không làm hỏng request tiếp theo.
- Model ready khác server live: UI không báo “sẵn sàng AI” khi checkpoint chưa load xong.

Tối ưu precision/ONNX/TensorRT sau baseline parity; thay precision phải chạy lại parity và ghi version.
