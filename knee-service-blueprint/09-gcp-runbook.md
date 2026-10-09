# 09 — GCP runbook: staging, public app và AI runtime

> **Cập nhật gần nhất:** 2026-10-10
> **Thay đổi gần nhất:** Tách mục tiêu Cloud Run staging/production; `dev` là QA nội bộ, `main` là production; CI/CD dùng GitHub Actions + WIF, VM vẫn dành cho GPU/Triton về sau.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

App dùng anonymous temporary session, không có tài khoản/mật khẩu. URL `rnsa-knee-web-service.vercel.app` là frontend; Vercel tự cấp HTTPS cho URL đó nhưng không tự chạy FastAPI. Vercel Preview dùng API staging, Vercel Production dùng API production thông qua same-origin `/api` rewrite.

Staging là môi trường Cloud Run riêng để nhóm QA/manual test nội bộ; production là Cloud Run phục vụ frontend public. VM `knee-review-staging-01` không còn là staging web: giữ private/off và dành GPU/Triton về sau. CD workflow được định nghĩa trong [15 — CI/CD](15-ci-cd-plan.md); cần cấu hình IAM/WIF, GitHub Environments, bucket/database và Vercel env trước khi workflow chạy thành công. Xem [18 — Anonymous session và giới hạn upload](18-anonymous-session-and-upload-limits.md) và [19 — Public preview deployment](19-public-preview-deployment.md).

## Môi trường và pipeline

```text
feature branch → PR dev (CI) → merge dev
                   ├─ Vercel Preview → Cloud Run staging (manual QA)
                   └─ GCS resumable DICOM upload
                                                ├─ shared session/study metadata store
                                                ├─ rate limits + cleanup
                                                └─ private GPU VM → Triton (later)
main ← reviewed/approved PR dev→main ← staging accepted → Cloud Run production
```

- Vercel frontend hiện có URL HTTPS công khai; không cần mua custom domain để test phần frontend. Cloud Run cấp URL HTTPS `run.app` cho API sau khi service được deploy.
- Local VM Compose + SQLite/files vẫn là môi trường staging cũ, chỉ để test qua IAP. Không mở nó công khai và không dùng làm backend lâu hạn.
- Backend hiện chưa sẵn để public: metadata/session và DICOM còn dựa SQLite/local filesystem. Trước Cloud Run cần shared session/study metadata (Firestore hoặc Cloud SQL) và Cloud Storage cho raw DICOM.
- ZIP mẫu khoảng 431 MiB; không gửi payload upload qua [Vercel Function](https://vercel.com/docs/functions/limitations) (request/response tối đa 4.5 MiB) hoặc [Vercel external rewrite](https://vercel.com/docs/routing/rewrites) (proxy timeout tối đa 120 giây). [Cloud Run](https://docs.cloud.google.com/run/quotas) giới hạn HTTP/1 request 32 MiB. Dùng browser → [Cloud Storage resumable upload](https://docs.cloud.google.com/storage/docs/resumable-uploads); FastAPI chỉ cấp phiên upload, xác nhận object, enqueue/điều phối ingest và trả trạng thái.
- HTTPS ở Vercel/Cloud Run do nền tảng kết thúc TLS; trong app phải đặt cookie Secure và cấu hình origin đúng. Rate limit cần áp dụng ở edge/API và theo session, giới hạn concurrent ingest, quota/storage, retention/cleanup. Không public endpoint chỉ vì có size cap.
- Chỉ dùng DICOM đã de-identify; không upload dữ liệu bệnh nhân thật vào preview.
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
