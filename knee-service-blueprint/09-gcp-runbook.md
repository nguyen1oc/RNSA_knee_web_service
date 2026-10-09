# 09 — GCP runbook: staging, public app và AI runtime

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Chốt public demo không cần tài khoản; workspace cô lập bằng HttpOnly session cookie, TTL và giới hạn upload.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

App dùng anonymous temporary session, không dùng username/password hay Firebase Identity Platform. VM `knee-review-staging-01` là môi trường staging private qua IAP; không phải production và không nên dùng để sửa source bằng tay. CI chỉ test/build; CD chưa tự động. Xem [18 — Anonymous session và giới hạn upload](18-anonymous-session-and-upload-limits.md).

## Môi trường và pipeline

```text
feature branch → PR dev (CI) → merge dev → deploy image SHA to private VM staging
                                             ↓ manual acceptance test
main ← reviewed PR dev→main ← staging accepted
  ↓
production deploy SHA (public HTTPS) — only after GCS + shared session metadata + abuse controls
```

- VM staging chạy Docker Compose, SQLite/named volume; phù hợp test anonymous sessions, upload limits và reset. Keep IAP; không mở cổng app ra Internet chỉ để test.
- Production public không được dựa vào local SQLite/files trên VM hoặc Cloud Run. Cloud Run writable filesystem không bền qua instance shutdown; DICOM tạm cần Cloud Storage và session/study metadata cần store chia sẻ giữa instances (ví dụ Firestore hoặc Cloud SQL).
- Public anonymous upload cần HTTPS, request/session/IP rate limits, concurrency caps, short retention và de-identified data. Không mở endpoint chỉ vì đã có size cap.
- Trước auto-deploy: Artifact Registry, separate staging/production projects or isolated resources, workload identity federation, least-privilege service accounts, health/smoke tests, backup/rollback và approval gate.

## Cấu hình staging VM

Sau khi feature đã review và merge vào `dev`, trên VM:

```bash
cd ~/knee-review/knee-web
git fetch origin
git checkout dev
git pull --ff-only origin dev
test -f .env || cp .env.example .env
```

`.env.example` mặc định đã có session TTL và caps; nếu muốn Secure cookie qua HTTPS, đặt `SESSION_COOKIE_SECURE=true`. Sau đó chạy:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 knee-web
```

Giữ VM private qua IAP. Test hai browser profile: session A upload/view, session B không thấy study A; A clear session thì file upload bị xóa; example còn; kiểm tra cap với file ZIP; xác nhận idle expiry. Chỉ dùng DICOM đã de-identified. SQLite/files nằm trên VM volume; backup/restore chưa được tự động hóa.

## Vai trò của GCP sau này

Triton Inference Server có thể chạy trong Docker trên Compute Engine GPU VM. GPU gắn với VM và được runtime cấp vào container; Triton không tự cấp/thuê GPU. GCS lưu artifact/checkpoint, không thực hiện inference. Nguồn: [GPU trên Compute Engine](https://docs.cloud.google.com/compute/docs/gpus/about-gpus), [Triton quickstart](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/getting_started/quickstart.html).

Khi bật phase AI, cần chọn topology rõ: app/worker cùng VM với Triton, hoặc app local gọi server inference remote qua kết nối riêng. Bản hiện tại không triển khai inference cloud.

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
