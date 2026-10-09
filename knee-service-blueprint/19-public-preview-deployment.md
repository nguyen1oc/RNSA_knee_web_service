# 19 — Public preview: Vercel + Cloud Run + GCP storage

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Hoàn tất cloud adapter/API cho Firestore + private GCS, thêm test adapter và sửa CORS cho chunked upload; GCP resources/deploy vẫn cần bạn thực hiện.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Trạng thái

- Frontend đã có URL Vercel `https://rnsa-knee-web-service.vercel.app/`; Vercel chỉ host React, không tự host FastAPI.
- Backend cloud path đã được code: Firestore repository, private GCS adapter, temporary sessions, upload trực tiếp resumable, finalize/index, đọc/xóa theo quyền sở hữu. Ruff/Mypy và 31 pytest pass; adapter tests dùng fake, chưa phải integration test với GCP thật.
- Chưa tạo bucket/Firestore/service account, chưa deploy Cloud Run, chưa test end-to-end trên URL.
- Hướng đích: Vercel → FastAPI Cloud Run → Firestore (session/study metadata) + private Cloud Storage (DICOM). VM hiện có không tham gia web request; để dành cho GPU/Triton khi có model.
- Local Docker tiếp tục dùng SQLite và filesystem để giữ workflow phát triển hiện có.

## Đã chọn

- **Firestore Native mode** cho session, study, series, instance metadata để dữ liệu index còn sau Cloud Run restart. Không chọn Cloud SQL ở MVP vì chưa cần reporting/query quan hệ.
- **Cloud Storage private bucket** cho byte DICOM và ZIP trung gian. Không lưu DICOM pixel bytes trong Firestore.
- Không đăng nhập. Mỗi browser có opaque temporary session; mọi API phải authorize owner theo session. Session idle 60 phút, tối đa 4 giờ; Clear xóa metadata và object.
- VM `knee-review-staging-01` giữ nguyên/off khi không dùng. Không deploy FastAPI vào VM này; GPU VM sẽ chạy Triton sau này. Không cần GPU cho ingest/viewer hiện tại.

## Vì sao cần đổi upload protocol

Study ZIP mẫu khoảng 431 MiB. Vercel Functions giới hạn request/response body 4.5 MiB; Vercel external rewrites giới hạn proxy duration; Cloud Run HTTP/1 giới hạn request 32 MiB. Vì vậy không gửi ZIP lớn qua Vercel hoặc Cloud Run multipart.

Luồng code: trình duyệt xin API tạo resumable upload session → upload bytes trực tiếp tới GCS theo các chunk 8 MiB → gọi API finalize → backend kiểm tra object, tải vào vùng xử lý tạm, validate/index DICOM, lưu DICOM objects riêng trong bucket → metadata ghi Firestore. Bucket không public; API kiểm tra session ownership trước khi cho đọc/xóa. Finalize hiện đồng bộ; khi dataset/tải tăng cần tách ingest thành job với polling.

Nguồn giới hạn: [Vercel Functions](https://vercel.com/docs/functions/limitations), [Cloud Run quotas](https://docs.cloud.google.com/run/quotas), [Cloud Storage resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads).

## Tạo bucket — chỉ làm khi code cloud branch sẵn sàng

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

### Checklist còn lại trước public link rộng

- Thêm distributed abuse/rate limit, đặc biệt `/api/sessions` và `/api/uploads/resumable`.
- Lên lịch dọn Firestore session/study hết hạn; cleanup hiện tại chỉ opportunistic khi có request và tối đa mỗi 5 phút trên mỗi instance.
- Chạy integration test với bucket/database thật, test hai browser profile, upload DICOM/ZIP, refresh, delete/Clear, session expiry và kiểm tra hóa đơn/quota.
- Seed example cloud nếu muốn trang mới có study mẫu; Cloud mode hiện không tự seed DICOM mẫu.

## Đề xuất rate limit + cleanup (chờ duyệt, chưa implement)

Mục tiêu là chống upload flood/chi phí bất ngờ mà không làm bác sĩ bị chặn khi nhiều người cùng dùng một Wi-Fi bệnh viện.

| Scope | Mức đề xuất ban đầu | Hành động khi vượt |
|---|---:|---|
| Tạo temporary session theo IP tin cậy | 10 lần / 10 phút, tối đa 30 / 24 giờ | HTTP 429 + `Retry-After`; không tạo Firestore session mới |
| Tạo upload slot theo session | 5 / phút, 30 / giờ; tối đa 3 upload đang chờ | HTTP 429; yêu cầu hoàn tất/xóa upload đang chờ |
| Finalize theo session | 3 lần / 10 phút; tối đa 500 DICOM và 800 MiB/session như giới hạn hiện có | HTTP 429/413; không finalize đồng thời cùng upload ID |
| GET study/series/slice/image | Không rate-limit chặt ở vòng đầu vì viewer tải nhiều ảnh; theo dõi 120 req/min/session trước khi điều chỉnh | Chỉ cảnh báo/log ở preview; thêm throttle nếu có scrape/abuse |

IP quota chỉ dùng khi đường vào API có trusted edge (khuyến nghị Cloud Armor phía External Application Load Balancer). Không tin trực tiếp `X-Forwarded-For` do client tự gửi. Cloud Run max instances `1` và concurrency `1` là trần chi phí/đồng thời, không thay thế rate limit. Nếu chưa dựng load balancer thì giai đoạn review chỉ áp dụng quota theo session, bật max instance 1, giữ URL chia sẻ giới hạn; chưa gọi là bảo vệ public chống bot.

Rate counter lưu ở collection riêng `rate_limits`, key là HMAC(IP/session + route + fixed time window), update atomic bằng Firestore transaction; không lưu IP thô. Đặt Firestore TTL trên field Timestamp `expires_at` để dọn counter sau 2 ngày. Response 429 có message thân thiện và `Retry-After`; không áp dụng cùng quota cho từng frame image.

### Cleanup đề xuất

1. Temporary session: idle 60 phút, absolute 4 giờ như hiện tại. Firestore expiry field nên là Timestamp; định kỳ query session hết hạn.
2. Cloud Scheduler gọi endpoint cleanup mỗi 15 phút bằng OIDC service account riêng; endpoint phải xác minh token/audience/email, không chỉ kiểm tra URL bí mật.
3. Theo từng session hết hạn: đọc danh sách DICOM object + pending upload, xóa object GCS trước, rồi xóa instance/series/study/session metadata. Nếu GCS xóa lỗi thì giữ metadata còn lại để lần scheduler sau retry; log số object lỗi và session ID đã hash.
4. Batch Firestore tối đa 450 writes mỗi lần; cleanup worker có giới hạn mỗi lượt (đề xuất 20 sessions hoặc 2,000 objects) để không chiếm request viewer quá lâu; Cloud Scheduler retry lần sau.
5. Lifecycle bucket chỉ xóa `incoming/` sau 1 ngày để dọn ZIP/object upload dở dang; không đặt lifecycle trên `sessions/`, vì sẽ xóa study đang hoạt động. Các resumable upload URL bị bỏ dở sẽ tự hết hạn theo quy định GCS.
6. Clear session/xóa study thủ công thực hiện cùng quy tắc: xóa blob thành công rồi mới commit xóa metadata; lỗi nào cũng trả trạng thái để retry, không báo đã xóa khi blob còn.

**Duyệt đề xuất trước khi implement:** các ngưỡng trên hợp cho demo nhỏ; chỉnh sau khi đo upload thật và chi phí. Vòng public giới hạn nên thêm alert budget, max instance 1, Cloud Armor rate policy, Cloud Scheduler cleanup và test retry/failure trước khi chia sẻ URL rộng. Đây là research preview, không gửi PHI.


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
