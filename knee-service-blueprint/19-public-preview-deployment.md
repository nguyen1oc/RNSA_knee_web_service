# 19 — Public preview: Vercel frontend + Cloud Run API

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Tách frontend Vercel khỏi FastAPI; xác định Cloud Run/GCS/shared metadata là backend public target, VM GPU chỉ dành cho Triton về sau.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Trạng thái hiện tại

- Frontend URL do người dùng cung cấp: `https://rnsa-knee-web-service.vercel.app/`. Vercel đã cung cấp HTTPS; không cần mua tên miền riêng để thử frontend.
- Vercel hiện chỉ host React. Frontend đang gọi relative `/api/...`, nhưng FastAPI chưa được deploy/kết nối ở Vercel, nên session/import/read API sẽ lỗi. Error banner phải luôn hiện nội dung fallback rõ ràng.
- FastAPI hiện chạy trong Docker Compose ở máy local hoặc VM staging private; SQLite và DICOM nằm ở local filesystem/named volume. Không public VM đó và không dùng VM GPU làm API host.
- Target: Vercel static frontend → FastAPI Cloud Run → private Cloud Storage + shared session/study metadata → GPU VM/Triton qua private network khi AI có model.

## Vì sao không chỉ thêm Vercel rewrite rồi deploy

Study mẫu `results.zip` khoảng 431 MiB. Vercel Functions giới hạn request/response body 4.5 MiB; external rewrites có thời gian proxy tối đa 120 giây. Cloud Run HTTP/1 giới hạn request 32 MiB. Do đó không gửi ZIP/DICOM bytes qua Vercel Function hoặc FastAPI request body trên Cloud Run.

Upload public cần browser khởi tạo resumable upload với FastAPI, gửi bytes trực tiếp vào private Cloud Storage, rồi gọi finalize API để xác minh object và enqueue ingest. FastAPI/worker đọc object theo session; không đưa bucket public. Ingest dài phải là job có trạng thái/polling, không giữ một request Vercel proxy mở trong lúc giải nén/index.

Nguồn giới hạn: [Vercel Functions](https://vercel.com/docs/functions/limitations), [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [Cloud Run quotas](https://docs.cloud.google.com/run/quotas), [Cloud Storage resumable upload](https://docs.cloud.google.com/storage/docs/resumable-uploads).

## HTTPS, session và rate limits

- Vercel frontend có HTTPS sẵn; Cloud Run service có HTTPS URL `run.app`. Chưa cần custom domain để thử hai endpoint riêng.
- Nếu API được gọi trực tiếp cross-origin, CORS phải allow đúng origin Vercel, cookie phải Secure và browser credential behavior phải kiểm thử. Nếu dùng same-origin Vercel rewrite cho API control calls, upload bytes vẫn đi thẳng GCS; keep proxy calls short.
- Không bật `allow_origins=*` với credentialed requests. Không tin `X-Forwarded-For` tùy mù: chỉ parse client IP theo proxy chain đã xác định và chặn direct bypass nếu rate-limit phụ thuộc proxy.
- Rate limiting không dùng in-memory map vì Cloud Run scale nhiều instances. Áp dụng distributed per-IP/per-session quotas cho session creation, upload-initiation, finalize và job polling; đặt quota bytes/files/concurrency, expiry cho upload session và project budgets/alerts. Thêm edge WAF/rate-based ban nếu chọn external HTTPS Load Balancer/Cloud Armor.
- Public uploads chỉ được dùng DICOM đã de-identify. UI thông báo dữ liệu tạm, session 60 phút idle/4 giờ tối đa; nút Clear session xóa objects/metadata. Cloud Storage lifecycle là cleanup dự phòng, không thay cho delete path.

## Các bước triển khai

### P0 — Kết nối giao diện và API theo cách an toàn

1. Hoàn thiện Vercel frontend build: `knee-web/frontend`, build `npm run build`, output `dist`; production branch là `main`, PR preview có thể dùng preview URL.
2. Tạo private Cloud Storage bucket cho uploads/temp objects, bật lifecycle theo retention đã chốt và CORS chỉ cho Vercel origin + required methods/headers.
3. Chuyển upload UI sang resumable direct-to-GCS; FastAPI cấp upload session/opaque object key, validate owner/session ở init/finalize và chỉ cho worker đọc object đã finalize.
4. Chuyển session/study/job metadata từ local SQLite sang shared store (Firestore là MVP candidate; Cloud SQL nếu cần relational reporting). DICOM byte không lưu trong SQL.
5. Deploy FastAPI/ingest worker riêng trên Cloud Run, attach least-privilege service account, cấu hình exact Vercel origin, HTTPS, health/readiness, timeout/memory/concurrency và upload caps.

### P1 — Rate limits, privacy và public smoke test

1. Chọn nơi rate-limit: shared backend counter (Firestore/Cloud SQL) cho per-IP/per-session, và Cloud Armor nếu đặt external HTTPS Load Balancer trước Cloud Run. Không rate-limit riêng Vercel static page rồi coi như API đã được bảo vệ.
2. Bật per-session max bytes/files (hiện default 800 MiB expanded, 500 DICOM), per-IP session/init limits, per-session upload/job limits, global concurrency cap, disk/bucket quota alerts và abuse logging không chứa DICOM metadata/PHI.
3. Thêm object cleanup khi user Clear, session expiry và failed/incomplete upload; kiểm tra TTL + lifecycle.
4. Từ mạng ngoài test: mở Vercel HTTPS; tạo session; upload study nhỏ và ZIP lớn direct-to-GCS; xem MPR; hai browser sessions không thấy dữ liệu nhau; clear/expiry xóa object; burst requests bị 429; invalid/expired upload URI bị từ chối.
5. Chỉ sau khi P0/P1 pass mới gửi URL cho reviewers. Không dùng patient-identifiable MRI; đây là research demo, không phải service chẩn đoán lâm sàng.

## Luồng branch/release

`feature → PR dev (CI + Vercel preview) → merge dev → review staging → PR dev→main → Vercel production + Cloud Run API release`. CI hiện không tự deploy API; credentials dùng Workload Identity Federation khi thiết lập CD, không để key trong repository.

## Chưa làm

Cloud bucket/firestore provisioning, upload protocol migration, Cloud Run deployment, distributed rate limiter/Cloud Armor policy, Vercel API routing/env, public URL smoke test và production CD. Local rate-limit middleware chưa được thêm vì không bảo vệ nhiều Cloud Run instances và không phải nơi phù hợp để cấu hình edge HTTPS/rate limits.
