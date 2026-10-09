# 19 — Public preview: Vercel + Cloud Run + GCP storage

> **Cập nhật gần nhất:** 2026-10-10
> **Thay đổi gần nhất:** Ghi rõ bootstrap order cho Vercel `KNEE_API_ORIGIN`: Cloud Run production phải được tạo và health-check trước khi nối frontend.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Trạng thái

- Frontend production là `https://rnsa-knee-web-service.vercel.app/`; branch feature có Preview `https://rnsa-knee-web-service-git-fe-7a5d7b-locntmasterc-5002s-projects.vercel.app/`. Vercel chỉ host React, không tự host FastAPI.
- **Staging = QA preview nội bộ**, phục vụ deploy từ `dev`; **production = backend public cho người dùng**, phục vụ deploy từ `main` sau review. VM không còn là web staging.
- Backend cloud path đã được code: Firestore repository, private GCS adapter, temporary sessions, upload trực tiếp resumable, finalize/index, đọc/xóa theo quyền sở hữu; quota upload/finalize phân tán và endpoint cleanup có xác minh OIDC. Cần chạy lại CI sau thay đổi; adapter tests dùng fake, chưa phải integration test với GCP thật.
- Staging bucket/Firestore, WIF/deployer, GitHub staging Environment/gate, Vercel Preview routing và Cloud Run `knee-review-api-staging` đã được xác nhận; `/api/health` trả `ok`. Public RSNA `results.zip` đã được provision thành shared `Example Knee Study` (284 DICOM, 5 series) trong staging GCS/Firestore.
- Workflow CD tách service `knee-review-api-staging` / `knee-review-api-production` đã được xác nhận chạy trên staging. Production resources, runtime/deployer identities, IAM và WIF main-only đã được tạo. **GitHub Environment `production` chưa có variables** (người dùng vừa xác nhận); Cloud Run production service/API URL và Vercel Production `KNEE_API_ORIGIN` cũng còn thiếu. Không trỏ Vercel production sang staging; hoàn tất Environment variables, deploy Cloud Run rồi thêm API origin và redeploy frontend. Vercel frontend build có thể tạm fail do env thiếu trong lần bootstrap đầu, nhưng không làm hỏng deployment frontend thành công hiện tại.
- Service cũ `knee-review-api` vẫn giữ nguyên, không bị workflow mới ghi đè. Cleanup Scheduler/TTL và full upload end-to-end chưa được xác nhận.
- Hướng đích: Vercel → FastAPI Cloud Run → Firestore (session/study metadata) + private Cloud Storage (DICOM). VM hiện có không tham gia web request; để dành cho GPU/Triton khi có model.
- Local Docker tiếp tục dùng SQLite và filesystem để giữ workflow phát triển hiện có.

Xem cấu hình đầy đủ và checklist thực hiện tại [15 — CI/CD: dev staging → main production](15-ci-cd-plan.md). Các lệnh deploy thủ công phía dưới là hướng dẫn lịch sử/khẩn cấp; không chạy chúng để provision production mới.

## Đã chọn

- **Firestore Native mode** cho session, study, series, instance metadata để dữ liệu index còn sau Cloud Run restart. Không chọn Cloud SQL ở MVP vì chưa cần reporting/query quan hệ.
- **Cloud Storage private bucket** cho byte DICOM và ZIP trung gian. Không lưu DICOM pixel bytes trong Firestore.
- Không đăng nhập. Mỗi browser có opaque temporary session; mọi API phải authorize owner theo session. Session idle 60 phút, tối đa 4 giờ; Clear xóa metadata và object.
- VM `knee-review-staging-01` giữ nguyên/off khi không dùng. Không deploy FastAPI vào VM này; GPU VM sẽ chạy Triton sau này. Không cần GPU cho ingest/viewer hiện tại.

## GCP resources đã tạo (2026-10-10)

Đã xác nhận từ các lệnh CLI người dùng chạy trong project `rsna-knee-511004`:

- **Cloud Storage:** bucket `gs://rsna-knee-dicom-preview-511004`, region `ASIA-SOUTHEAST1`, Standard; Uniform bucket-level access bật, Public access prevention `enforced`.
- **Artifact Registry:** Docker repository `knee-review` tại `asia-southeast1`, URI `asia-southeast1-docker.pkg.dev/rsna-knee-511004/knee-review`; GitHub Actions dùng để lưu image theo commit SHA. Vulnerability scanning chưa bật vì API `containerscanning.googleapis.com` chưa được enable. Repo `cloud-run-source-deploy` là repo riêng.
- **CORS:** Preview origin đã được thêm vào local template `templates/gcs-cors.json`; người dùng cần xác nhận bucket đã nhận cấu hình bằng `gcloud storage buckets describe`. API Preview session POST trả 200, nên origin đó hiện được backend chấp nhận.
- **Production resources:** Firestore Native database `knee-review-production`, bucket `gs://rsna-knee-dicom-production-511004`, và runtime identity `knee-review-api-production@rsna-knee-511004.iam.gserviceaccount.com` đã được người dùng xác nhận tạo tại `asia-southeast1`. Bucket Standard, Uniform bucket-level access bật, Public access prevention `enforced`, soft-delete retention 7 ngày; CORS chỉ cho `https://rnsa-knee-web-service.vercel.app`; lifecycle chỉ xóa prefix `incoming/` từ 1 ngày tuổi. Runtime có Object Admin trên riêng bucket và Datastore User condition giới hạn database production. Cloud Run service và Vercel API routing production chưa tạo.
- **Lifecycle:** chỉ xóa object có prefix `incoming/` từ 1 ngày tuổi; không áp dụng cho dữ liệu study đang hoạt động.
- **Soft delete:** bucket hiện có retention mặc định 7 ngày. Xóa khỏi app là xóa khỏi vùng object đang hoạt động, nhưng vẫn có thể khôi phục trong thời gian retention và storage của bản đã xóa có thể bị tính phí. Chưa thay đổi policy này.
- **Firestore:** database `(default)`, `FIRESTORE_NATIVE`, region `asia-southeast1`, free tier báo bật. Backend client mặc định dùng database này; không cần chọn DB trong từng request.
- **Example staging:** `results.zip` public đã được nạp thành `sample-knee` (`source=sample`, owner rỗng) với 5 series/284 instances; DICOM ở prefix `gs://rsna-knee-dicom-preview-511004/examples/sample-knee/`. Không nằm trong production và không bị session cleanup xóa.
- **Staging service identity:** `knee-review-api@rsna-knee-511004.iam.gserviceaccount.com`; có `roles/datastore.user` với IAM condition chỉ vào Firestore `(default)` và `roles/storage.objectAdmin` trên bucket staging.
- **Deployer:** tài khoản `gcloud` hiện tại đã có `roles/iam.serviceAccountUser` trên service account để có thể gắn nó khi deploy Cloud Run.
- Không tạo/tải service-account key JSON. Cloud Run sẽ lấy credential từ service identity/ADC.
- **Đã xác nhận:** Cloud Run service cũ `knee-review-api` và service CD staging `knee-review-api-staging` hiện có; staging health trả `ok`. Đây chưa phải production API.
- **Còn làm:** thêm variables vào GitHub Environment `production`, rồi deploy Cloud Run production và xác nhận health. Sau đó đặt `KNEE_API_ORIGIN` trong Vercel Production và redeploy frontend. Vercel build lần đầu có thể fail do origin chưa tồn tại; không điền URL staging. Staging upload/delete đã được người dùng xác nhận thành công sau khi thu hẹp Firestore IAM. Thiết lập Scheduler/TTL, edge protection và upload integration test trước khi chia sẻ rộng. VM GPU/Triton không liên quan.

## Vì sao cần đổi upload protocol

Study ZIP mẫu khoảng 431 MiB. Vercel Functions giới hạn request/response body 4.5 MiB; Vercel external rewrites giới hạn proxy duration; Cloud Run HTTP/1 giới hạn request 32 MiB. Vì vậy không gửi ZIP lớn qua Vercel hoặc Cloud Run multipart.

Luồng code: trình duyệt xin API tạo resumable upload session → upload bytes trực tiếp tới GCS theo các chunk 8 MiB → gọi API finalize → backend kiểm tra object, tải vào vùng xử lý tạm, validate/index DICOM, lưu DICOM objects riêng trong bucket → metadata ghi Firestore. Bucket không public; API kiểm tra session ownership trước khi cho đọc/xóa. Khi chọn nhiều `.dcm`/folder, frontend tạo một ZIP không nén trong browser để dùng một upload-init request thay vì một request cho mỗi slice; Series paths được giữ và backend gom study theo `StudyInstanceUID`. Finalize hiện đồng bộ; khi dataset/tải tăng cần tách ingest thành job với polling.

Nguồn giới hạn: [Vercel Functions](https://vercel.com/docs/functions/limitations), [Cloud Run quotas](https://docs.cloud.google.com/run/quotas), [Cloud Storage resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads).

## Cấu hình bucket (đã hoàn tất)

Chọn region `asia-southeast1` (Singapore), Standard storage, bật **Uniform bucket-level access** và **Public access prevention**. Tên bucket phải global-unique; gợi ý `rsna-knee-dicom-preview-511004` rồi kiểm tra tên trước khi tạo. Không cấp `allUsers` hoặc `allAuthenticatedUsers`. CORS phải allow đúng production và Preview origins; template gồm `Content-Range` cho upload chunk và `Range` để frontend đọc vị trí đã nhận. Configure lifecycle chỉ cho prefix `incoming/` (ZIP/DICOM upload chưa finalize), không áp dụng rule xóa theo tuổi lên `sessions/` vì đó là study đang hoạt động. Study được xóa khi user Clear session hoặc hết TTL.

Tạo Firestore Native mode ở `asia-southeast1` nếu project chưa có database; vị trí database không đổi được sau khi tạo. Cloud Run dùng service account riêng, cấp `roles/datastore.user` cho Firestore và `roles/storage.objectAdmin` ở riêng bucket (không cấp project-wide nếu không cần); deployer cần `roles/iam.serviceAccountUser` trên service account. Không tải service-account key xuống máy, không commit key. Cloud Run dùng service identity/ADC.

## Các bước code/deploy (lệnh PowerShell)

### Provision GCP resources

Chạy lệnh sau sau khi merge feature vào `dev`; tên bucket phải global-unique. Nếu Firestore `(default)` đã có, bỏ qua lệnh tạo database và kiểm tra đúng region/mode trước.

```powershell
gcloud config set project rsna-knee-511004
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com firestore.googleapis.com

$bucket = "rsna-knee-dicom-preview-511004"
$serviceAccount = "knee-review-api"

gcloud storage buckets create "gs://$bucket" --project=rsna-knee-511004 --location=asia-southeast1 --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$bucket" --cors-file="knee-service-blueprint/templates/gcs-cors.json" --lifecycle-file="knee-service-blueprint/templates/gcs-incoming-lifecycle.json"
gcloud firestore databases create --database="(default)" --location=asia-southeast1 --type=firestore-native --project=rsna-knee-511004
gcloud iam service-accounts create $serviceAccount --project=rsna-knee-511004 --display-name="Knee Review Cloud Run API"
gcloud projects add-iam-policy-binding rsna-knee-511004 --member="serviceAccount:$serviceAccount@rsna-knee-511004.iam.gserviceaccount.com" --role=roles/datastore.user
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$serviceAccount@rsna-knee-511004.iam.gserviceaccount.com" --role=roles/storage.objectAdmin
```

### Deploy review API

Sau khi merge source vào `dev`, từ thư mục repo chạy:

```powershell
cd knee-web
gcloud run deploy knee-review-api --source . --project=rsna-knee-511004 --region=asia-southeast1 --platform=managed --allow-unauthenticated --service-account="knee-review-api@rsna-knee-511004.iam.gserviceaccount.com" --memory=4Gi --cpu=2 --concurrency=1 --max=1 --timeout=3600 --set-env-vars="METADATA_BACKEND=firestore,DICOM_BUCKET=rsna-knee-dicom-preview-511004,GOOGLE_CLOUD_PROJECT=rsna-knee-511004,CORS_ALLOWED_ORIGINS=https://rnsa-knee-web-service.vercel.app,SESSION_COOKIE_SECURE=true,MAX_UPLOAD_MIB=600,MAX_EXPANDED_MIB=800,MAX_SESSION_MIB=800"
```

`--allow-unauthenticated` làm API public; study vẫn yêu cầu temporary browser session nhưng hiện chưa có distributed anti-abuse/rate limit. Đây chỉ là review preview, max instances giới hạn 1; chỉ dùng DICOM đã de-identify. Sau deploy, test `/api/health`, rồi lấy service URL để cấu hình Vercel same-origin rewrite `/api/:path*`. Vercel env: `VITE_DIRECT_GCS_UPLOAD=true`, `VITE_API_BASE_URL` để trống; redeploy frontend. Bucket CORS cần cho phép `Content-Range` (request chunk) và expose `Range` (ack chunk).

### Rate limits đã triển khai và giới hạn còn lại

- `/api/uploads/resumable`: 5 lần/phút và 30 lần/giờ/session; tối đa 3 upload còn `uploading`; tổng file/session vẫn bị chặn ở 800 MiB. Chỉ chuyển pending slot sang `uploaded` sau khi backend xác nhận kích thước object trên GCS.
- `/api/studies/finalize-upload`: 3 lần/10 phút/session. Giới hạn hiện có 600 MiB/file, 800 MiB/session/expanded và 500 DICOM vẫn áp dụng.
- Counters nằm trong Firestore `rate_limits`, tăng nguyên tử bằng transaction, ID counter được hash, không lưu IP. Có thể cấu hình Firestore TTL cho `expires_at` sau 2 ngày.
- GET viewer/slice/image chưa bị throttle để tránh làm hỏng trải nghiệm cuộn lát; theo dõi trước.
- `/api/sessions` chưa có quota IP trong ứng dụng. Không đọc `X-Forwarded-For` trực tiếp: khi chỉ có Vercel rewrite tới Cloud Run, cần chứng minh được header/IP do trusted proxy đặt và chặn đường gọi vòng ngoài trước khi dùng nó làm khóa. Vercel WAF fixed window có thể cấu hình 10 request/10 phút trên `POST /api/sessions`, nhưng ngưỡng 30/ngày không được thực thi bởi backend hiện tại; không công bố rằng IP cap đã bật cho tới khi cấu hình và kiểm thử edge.

### Checklist còn lại trước public link rộng

- Cấu hình Vercel WAF 10/10 phút cho `POST /api/sessions` (ban đầu Log, kiểm tra false positive, rồi chuyển Block). Đây là lớp edge, không phải code FastAPI.
- Cấu hình Firestore TTL và Cloud Scheduler bên dưới; verify chính xác service account OIDC.
- Chạy integration test với bucket/database thật, test hai browser profile, upload DICOM/ZIP, refresh, delete/Clear, session expiry và kiểm tra hóa đơn/quota.
- Seed example cloud nếu muốn trang mới có study mẫu; Cloud mode hiện không tự seed DICOM mẫu.

## Cấu hình rate limit và cleanup trên GCP

Mục tiêu là chống upload flood/chi phí bất ngờ mà không làm bác sĩ bị chặn khi nhiều người cùng dùng một Wi-Fi bệnh viện.

| Scope | Mức đề xuất ban đầu | Hành động khi vượt |
|---|---:|---|
| Tạo temporary session theo IP tin cậy | Chưa bật trong API; mục tiêu ban đầu 10 / 10 phút và 30 / ngày | Cấu hình 10/10 phút ở WAF; daily cap cần edge/shared counter đáng tin trước khi bật |
| Tạo upload slot theo session | **5 / phút, 30 / giờ; tối đa 3 upload đang truyền** | HTTP 429; upload đã xác minh kích thước chuyển trạng thái `uploaded` |
| Finalize theo session | **3 / 10 phút**; tối đa 500 DICOM, 600 MiB/file và 800 MiB/session | HTTP 429/413; upload chưa hoàn tất trả 409 |
| GET study/series/slice/image | Không rate-limit chặt ở vòng đầu vì viewer tải nhiều ảnh; theo dõi 120 req/min/session trước khi điều chỉnh | Chỉ cảnh báo/log ở preview; thêm throttle nếu có scrape/abuse |

Không tin trực tiếp `X-Forwarded-For` do client tự gửi. Cloud Run max instances `1` và concurrency `1` là trần chi phí/đồng thời, không thay thế rate limit. Rate counter Firestore không lưu IP thô; hiện chỉ dùng session ID. Với Vercel WAF, tạo rule match `POST /api/sessions`, limit 10 requests / 10-minute fixed window, key theo client IP do Vercel edge xác định; bắt đầu ở Log rồi Block sau khi kiểm tra. Vercel plan và edge behavior có thể giới hạn daily window; 30/ngày chưa được bảo đảm. Nếu cần đúng mức 30/ngày, dùng trusted edge có shared durable counter (ví dụ Cloud Armor/edge service) và chỉ nhận traffic qua edge đó.

Rate counter lưu ở collection riêng `rate_limits`, doc ID là SHA-256 của route/session/fixed window, update atomic bằng Firestore transaction; không lưu IP thô. Đặt Firestore TTL trên field Timestamp `expires_at` để dọn counter sau 2 ngày. Response 429 có message thân thiện và `Retry-After`; không áp dụng cùng quota cho từng frame image.

### Cleanup đề xuất

1. Temporary session: idle 60 phút, absolute 4 giờ như hiện tại. Firestore expiry field nên là Timestamp; định kỳ query session hết hạn.
2. Cloud Scheduler gọi `POST /internal/cleanup` mỗi 15 phút bằng OIDC service account riêng. Endpoint xác minh chữ ký token, audience, email và `email_verified`; không chỉ kiểm tra URL bí mật.
3. Theo từng session hết hạn: đọc danh sách DICOM object + pending upload, xóa object GCS trước, rồi xóa instance/series/study/session metadata. Nếu GCS xóa lỗi thì giữ metadata còn lại để lần scheduler sau retry; log số object lỗi và session ID đã hash.
4. Batch Firestore tối đa 450 writes mỗi lần; cleanup worker có giới hạn mỗi lượt (đề xuất 20 sessions hoặc 2,000 objects) để không chiếm request viewer quá lâu; Cloud Scheduler retry lần sau.
5. Lifecycle bucket chỉ xóa `incoming/` sau 1 ngày để dọn ZIP/object upload dở dang; không đặt lifecycle trên `sessions/`, vì sẽ xóa study đang hoạt động. Object uploads moved into `sessions/` must never inherit this rule.
6. Clear session/xóa study thủ công thực hiện cùng quy tắc: xóa blob thành công rồi mới commit xóa metadata; lỗi nào cũng trả trạng thái để retry, không báo đã xóa khi blob còn.

Ngưỡng trên là cấu hình preview đã chốt; đo upload/chi phí rồi điều chỉnh có chủ đích. Trước khi chia sẻ rộng cần budget alert, max instance 1, edge rate policy, Scheduler cleanup, TTL và test lỗi/retry. Đây là research preview, không gửi PHI.

### Thiết lập Firestore TTL và Cloud Scheduler

Chạy sau khi Cloud Run đã deploy. Thay project nếu không dùng project đang cấu hình:

```powershell
$project = "rsna-knee-511004"
$region = "asia-southeast1"
$service = "knee-review-api"
$schedulerAccount = "knee-review-cleaner"
$serviceUrl = gcloud run services describe $service --project=$project --region=$region --format="value(status.url)"
$schedulerEmail = "$schedulerAccount@$project.iam.gserviceaccount.com"

gcloud services enable cloudscheduler.googleapis.com --project=$project
gcloud iam service-accounts create $schedulerAccount --project=$project --display-name="Knee Review scheduled cleanup"
gcloud run services add-iam-policy-binding $service --project=$project --region=$region --member="serviceAccount:$schedulerEmail" --role="roles/run.invoker"
gcloud run services update $service --project=$project --region=$region --update-env-vars="CLEANUP_SCHEDULER_EMAIL=$schedulerEmail,CLEANUP_OIDC_AUDIENCE=$serviceUrl"
gcloud firestore fields ttls update expires_at --collection-group=rate_limits --enable-ttl --database="(default)" --project=$project
gcloud scheduler jobs create http knee-review-cleanup --project=$project --location=$region --schedule="*/15 * * * *" --time-zone="Etc/UTC" --uri="$serviceUrl/internal/cleanup" --http-method=POST --oidc-service-account="$schedulerEmail" --oidc-token-audience="$serviceUrl" --attempt-deadline=300s --max-backoff=3600s
```

Nếu Scheduler job đã tồn tại, dùng `gcloud scheduler jobs update http ...` với các tham số tương ứng thay vì `create`. Chạy thử bằng `gcloud scheduler jobs run knee-review-cleanup --location=$region --project=$project`, rồi kiểm tra Executions/logs và Cloud Run logs. Scheduler service account cần `roles/run.invoker`; backend còn kiểm tra đúng email trong `CLEANUP_SCHEDULER_EMAIL`. TTL chỉ áp dụng `rate_limits.expires_at`, không cấu hình TTL cho study/session vì app phải xóa blob GCS trước metadata. Firestore TTL có thể xóa trễ; TTL chỉ là dọn counter, không phải cleanup DICOM.


## VM và chi phí

VM không phải nơi deploy backend web trong topology này. Có thể giữ VM ở trạng thái stopped khi không cần SSH; boot disk và tài nguyên IP tĩnh vẫn có thể phát sinh phí. Khi bắt đầu Triton, bật VM GPU theo thời gian thử nghiệm, attach GPU, cài NVIDIA Container Toolkit/Triton và hạn chế endpoint inference vào private network/IAM. Tắt VM khi xong; GPU không được cấp tự động bởi Triton.

## Chưa hoàn tất

Hoàn tất one-time setup để chạy CD staging/production (WIF/IAM, GitHub Environments, production resources, Vercel env), trusted-edge session-creation protection, Cloud Scheduler/Firestore TTL, optional sample-study cloud seeding và end-to-end public smoke test. Bucket/Firestore staging và service `knee-review-api` hiện tại đã được provision; xem trạng thái đầu tài liệu. Không gửi study định danh bệnh nhân lên URL công khai; dự án là research demo, không phải thiết bị chẩn đoán lâm sàng.

### Tài liệu GCP tham khảo

- [Cloud Run service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity)
- [Firestore Native mode: create/manage databases](https://cloud.google.com/firestore/docs/manage-databases)
- [Cloud Storage CORS](https://docs.cloud.google.com/storage/docs/cross-origin)
- [Cloud Storage resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads)
- [Uniform bucket-level access](https://docs.cloud.google.com/storage/docs/uniform-bucket-level-access)
<details>
<summary>Earlier deployment plan from 2026-10-09 (superseded; before GCP resources were provisioned)</summary>

#### Earlier plan snapshot

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

`feature → PR dev (CI + Vercel preview) → merge dev → Cloud Run staging + review → PR dev→main → approval production → Cloud Run production + Vercel production`. GitHub Actions dùng Workload Identity Federation, không lưu service-account key trong repository. Production chưa được deploy cho đến khi Environment `production` có đủ variables và reviewer approval.

## Việc còn lại trước khi chia sẻ rộng

Production GitHub Environment variables, Cloud Run production service, Vercel Production API origin, cleanup Scheduler/Firestore TTL, edge protection và end-to-end public smoke test. Local rate-limit middleware chưa được thêm vì không bảo vệ nhiều Cloud Run instances và không phải nơi phù hợp để cấu hình edge HTTPS/rate limits.
</details>
