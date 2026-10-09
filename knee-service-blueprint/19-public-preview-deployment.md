# 19 — Public preview: Vercel + Cloud Run + GCP storage

> **Cập nhật gần nhất:** 2026-10-10
> **Thay đổi gần nhất:** Ghi nhận bucket, Firestore `(default)`, service account và IAM đã provision; Cloud Run, Scheduler và TTL chưa triển khai.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Trạng thái

- Frontend đã có URL Vercel `https://rnsa-knee-web-service.vercel.app/`; Vercel chỉ host React, không tự host FastAPI.
- Backend cloud path đã được code: Firestore repository, private GCS adapter, temporary sessions, upload trực tiếp resumable, finalize/index, đọc/xóa theo quyền sở hữu; quota upload/finalize phân tán và endpoint cleanup có xác minh OIDC. Cần chạy lại CI sau thay đổi; adapter tests dùng fake, chưa phải integration test với GCP thật.
- Bucket, Firestore `(default)` và quyền service account đã được xác nhận qua output `gcloud` do người dùng chạy ngày 2026-10-10; Cloud Run chưa deploy, Scheduler/TTL chưa cấu hình và chưa có end-to-end test.
- Hướng đích: Vercel → FastAPI Cloud Run → Firestore (session/study metadata) + private Cloud Storage (DICOM). VM hiện có không tham gia web request; để dành cho GPU/Triton khi có model.
- Local Docker tiếp tục dùng SQLite và filesystem để giữ workflow phát triển hiện có.

## Đã chọn

- **Firestore Native mode** cho session, study, series, instance metadata để dữ liệu index còn sau Cloud Run restart. Không chọn Cloud SQL ở MVP vì chưa cần reporting/query quan hệ.
- **Cloud Storage private bucket** cho byte DICOM và ZIP trung gian. Không lưu DICOM pixel bytes trong Firestore.
- Không đăng nhập. Mỗi browser có opaque temporary session; mọi API phải authorize owner theo session. Session idle 60 phút, tối đa 4 giờ; Clear xóa metadata và object.
- VM `knee-review-staging-01` giữ nguyên/off khi không dùng. Không deploy FastAPI vào VM này; GPU VM sẽ chạy Triton sau này. Không cần GPU cho ingest/viewer hiện tại.

## GCP resources đã tạo (2026-10-10)

Đã xác nhận từ các lệnh CLI người dùng chạy trong project `rsna-knee-511004`:

- **Cloud Storage:** bucket `gs://rsna-knee-dicom-preview-511004`, region `ASIA-SOUTHEAST1`, Standard; Uniform bucket-level access bật, Public access prevention `enforced`.
- **CORS:** chỉ cho origin `https://rnsa-knee-web-service.vercel.app`; method PUT/POST; cho phép `Content-Range`, expose `Range` cùng các header upload cần thiết.
- **Lifecycle:** chỉ xóa object có prefix `incoming/` từ 1 ngày tuổi; không áp dụng cho dữ liệu study đang hoạt động.
- **Soft delete:** bucket hiện có retention mặc định 7 ngày. Xóa khỏi app là xóa khỏi vùng object đang hoạt động, nhưng vẫn có thể khôi phục trong thời gian retention và storage của bản đã xóa có thể bị tính phí. Chưa thay đổi policy này.
- **Firestore:** database `(default)`, `FIRESTORE_NATIVE`, region `asia-southeast1`, free tier báo bật. Backend client mặc định dùng database này; không cần chọn DB trong từng request.
- **Service identity:** `knee-review-api@rsna-knee-511004.iam.gserviceaccount.com`; đã cấp `roles/datastore.user` trên project và `roles/storage.objectAdmin` trên đúng bucket.
- **Deployer:** tài khoản `gcloud` hiện tại đã có `roles/iam.serviceAccountUser` trên service account để có thể gắn nó khi deploy Cloud Run.
- Không tạo/tải service-account key JSON. Cloud Run sẽ lấy credential từ service identity/ADC.
- **Chưa làm:** deploy Cloud Run, gắn env vars, Scheduler service account/job, Firestore TTL, Vercel trỏ API production/review, upload smoke test. VM GPU/Triton không liên quan tới bước này.

## Vì sao cần đổi upload protocol

Study ZIP mẫu khoảng 431 MiB. Vercel Functions giới hạn request/response body 4.5 MiB; Vercel external rewrites giới hạn proxy duration; Cloud Run HTTP/1 giới hạn request 32 MiB. Vì vậy không gửi ZIP lớn qua Vercel hoặc Cloud Run multipart.

Luồng code: trình duyệt xin API tạo resumable upload session → upload bytes trực tiếp tới GCS theo các chunk 8 MiB → gọi API finalize → backend kiểm tra object, tải vào vùng xử lý tạm, validate/index DICOM, lưu DICOM objects riêng trong bucket → metadata ghi Firestore. Bucket không public; API kiểm tra session ownership trước khi cho đọc/xóa. Finalize hiện đồng bộ; khi dataset/tải tăng cần tách ingest thành job với polling.

Nguồn giới hạn: [Vercel Functions](https://vercel.com/docs/functions/limitations), [Cloud Run quotas](https://docs.cloud.google.com/run/quotas), [Cloud Storage resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads).

## Cấu hình bucket (đã hoàn tất)

Chọn region `asia-southeast1` (Singapore), Standard storage, bật **Uniform bucket-level access** và **Public access prevention**. Tên bucket phải global-unique; gợi ý `rsna-knee-dicom-preview-511004` rồi kiểm tra tên trước khi tạo. Không cấp `allUsers` hoặc `allAuthenticatedUsers`. CORS chỉ allow `https://rnsa-knee-web-service.vercel.app`; template gồm `Content-Range` cho upload chunk và `Range` để frontend đọc vị trí đã nhận. Configure lifecycle chỉ cho prefix `incoming/` (ZIP/DICOM upload chưa finalize), không áp dụng rule xóa theo tuổi lên `sessions/` vì đó là study đang hoạt động. Study được xóa khi user Clear session hoặc hết TTL.

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

GCP resources, Cloud Run deployment/CD, distributed rate limit/session-creation protection, scheduled Firestore cleanup/TTL, optional sample-study cloud seeding và public smoke test. Không gửi study định danh bệnh nhân lên URL công khai; dự án là research demo, không phải thiết bị chẩn đoán lâm sàng.

### Tài liệu GCP tham khảo

- [Cloud Run service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity)
- [Firestore Native mode: create/manage databases](https://cloud.google.com/firestore/docs/manage-databases)
- [Cloud Storage CORS](https://docs.cloud.google.com/storage/docs/cross-origin)
- [Cloud Storage resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads)
- [Uniform bucket-level access](https://docs.cloud.google.com/storage/docs/uniform-bucket-level-access)
