# 09 — GCP và Triton: giai đoạn sau

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Chuẩn hóa metadata tài liệu; GCP/Triton vẫn deferred, không là gate local.  
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

**Hoãn từ 05/10/2026.** Sprint hiện tại chạy local không auth; không tạo tài nguyên cloud hoặc yêu cầu quota/GPU/checkpoint để hoàn thành viewer. Runbook local ở [12](12-local-docker-build-steps.md). Thiết kế IAP trong phiên bản 30/09 đã được rút khỏi scope, không mặc định áp lại.

## Vai trò của GCP sau này

Triton Inference Server có thể chạy trong Docker trên Compute Engine GPU VM. GPU gắn với VM và được runtime cấp vào container; Triton không tự cấp/thuê GPU. GCS lưu artifact/checkpoint, không thực hiện inference. Nguồn: [GPU trên Compute Engine](https://docs.cloud.google.com/compute/docs/gpus/about-gpus), [Triton quickstart](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/getting_started/quickstart.html).

Khi bật phase AI, cần chọn topology rõ: app/worker cùng VM với Triton, hoặc app local gọi server inference remote qua kết nối riêng. Bản local hiện tại không triển khai đường mạng cloud. Việc triển khai cloud không tự thêm tính năng tài khoản/mật khẩu vào web.

## Công việc chỉ làm khi bắt đầu phase AI

1. Chốt checkpoint/architecture/preprocessing/class order và score semantics theo file 06.
2. Đóng gói model repository + Python wrapper hoặc backend format phù hợp; pin Triton/framework/CUDA.
3. Chạy offline reference và Triton parity; đo RAM/VRAM, cold/warm latency.
4. Chọn VM/GPU/region, quyền/quota và ngân sách dựa trên model thực.
5. Cấu hình container GPU, persistent storage cho model/artifacts và kết nối FastAPI/worker → Triton.
6. Thêm job inference/snapshot/results/API/panel; viewer tiếp tục hoạt động khi model unavailable.
7. Kiểm tra readiness, timeout/OOM/restart và benchmark trên môi trường thực.

Server live khác model ready. Checkpoint .pth không tự trở thành service chỉ bằng copy file; cần runtime/code và input/output contract. Batching/concurrency chỉ bật khi model và shapes hỗ trợ.

## Vận hành để thiết kế sau

Model/version provenance, metric queue/infer/error, backup/restore và rollback có kiểm tra schema; startup load model một lần. Triton ports/metrics là endpoint hạ tầng, không phải đường upload study từ browser. Network exposure được thiết kế khi chốt cloud topology, không suy từ Compose localhost.

Giá, quota, GPU availability và compatibility phải xác minh ở thời điểm triển khai. Giai đoạn local không phát sinh chi phí GPU GCP do kế hoạch này.
