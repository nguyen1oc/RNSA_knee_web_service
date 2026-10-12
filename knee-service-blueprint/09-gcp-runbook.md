# 09 — GCP runbook: staging, public app và AI runtime

> **Cập nhật gần nhất:** 2026-10-13
> **Thay đổi gần nhất:** Triton L4 và API đã được cấu hình riêng cho staging/production. Ngày 13/10, API health và Triton readiness đã được kiểm tra; người vận hành báo đã thử Analyze trên production thành công. Xem [21 — tài liệu bàn giao](21-project-handover.md) để biết phần nào đã được xác minh độc lập.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

App dùng anonymous temporary session, không có tài khoản/mật khẩu. URL `rnsa-knee-web-service.vercel.app` là frontend; Vercel tự cấp HTTPS cho URL đó nhưng không tự chạy FastAPI. Vercel Preview dùng API staging, Vercel Production dùng API production thông qua same-origin `/api` rewrite.

Staging là Cloud Run QA nội bộ; production là Cloud Run backend phục vụ frontend public. API, bucket, Firestore và runtime identities đã được tách theo môi trường. Triton L4 riêng tư đã được cấu hình cho cả staging và production. Staging Analyze đã được kiểm tra end-to-end; người vận hành báo production Analyze cũng chạy thành công. VM `knee-review-staging-01` không chạy web hay Triton hiện tại; không cần bật VM cho Cloud Run GPU. Xem [20 — Triton Cloud Run GPU](20-triton-cloudrun-gpu.md), [19 — Public preview deployment](19-public-preview-deployment.md) và [21 — tài liệu bàn giao](21-project-handover.md).

## Môi trường và pipeline

```text
feature branch → PR dev (CI) → merge dev
                   ├─ Vercel Preview → Cloud Run staging (manual QA)
                   ├─ GCS resumable DICOM upload
                   └─ FastAPI staging → private Cloud Run L4/Triton staging
main ← reviewed/approved PR dev→main ← staging accepted
  └─ FastAPI production → private Cloud Run L4/Triton production
```

- Vercel frontend hiện có URL HTTPS công khai; không cần mua custom domain để test phần frontend. Cloud Run cấp URL HTTPS `run.app` cho API sau khi service được deploy.
- Local VM Compose + SQLite/files vẫn là môi trường staging cũ, chỉ để test qua IAP. Không mở nó công khai và không dùng làm backend lâu hạn.
- Cloud Run API dùng Firestore cho metadata/session và private GCS cho raw DICOM; local Compose vẫn dùng SQLite/filesystem.
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

## Triton và GPU hiện tại

Triton chạy trong một Cloud Run GPU service riêng; FastAPI vẫn thực hiện session/ownership checks và preprocessing trên CPU, sau đó gọi Triton riêng tư bằng Cloud Run ID token. Checkpoint được mount read-only từ model-artifact bucket, không nằm trong image và không dùng chung DICOM bucket. Cả staging và production đã có Triton service riêng; xem trạng thái kiểm tra và rollout tại [20 — Triton](20-triton-cloudrun-gpu.md) và [21 — tài liệu bàn giao](21-project-handover.md). Không cần VM T4 song song.

Server live khác model ready. Checkpoint .pth không tự trở thành service chỉ bằng copy file; cần runtime/code và input/output contract. Batching/concurrency chỉ bật khi model và shapes hỗ trợ.

## Vận hành để thiết kế sau

Model/version provenance, metric queue/infer/error, backup/restore và rollback có kiểm tra schema; startup load model một lần. Triton ports/metrics là endpoint hạ tầng, không phải đường upload study từ browser. Network exposure được thiết kế khi chốt cloud topology, không suy từ Compose localhost.

Giá, quota, GPU availability và compatibility phải xác minh ở thời điểm triển khai. Giai đoạn local không phát sinh chi phí GPU GCP do kế hoạch này.
