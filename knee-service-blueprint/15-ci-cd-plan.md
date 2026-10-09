# 15 — CI/CD: dev staging → main production

> **Cập nhật gần nhất:** 2026-10-10
> **Thay đổi gần nhất:** Chuyển base image sang Google `mirror.gcr.io` sau khi Artifact Registry remote repo gặp upstream auth timeout.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Mục tiêu và ý nghĩa môi trường

- **Staging** là môi trường preview nội bộ để QA thủ công. Ở đây kiểm tra upload/view/delete, browser/session flow, lỗi giao diện và cấu hình trước khi phát hành. Không đưa dữ liệu bệnh nhân thật vào.
- **Production** là endpoint backend gắn với frontend public cho người dùng. Chỉ cập nhật sau khi thay đổi đã được review và chấp nhận ở staging.
- `dev` → Cloud Run `knee-review-api-staging`; `main` → Cloud Run `knee-review-api-production`. Hai service phải dùng bucket, Firestore database và runtime service account tách biệt.
- Vercel vẫn deploy frontend độc lập: deployment Preview dùng API staging; deployment Production dùng API production. Frontend gọi cùng-origin `/api`, Vercel rewrite sang Cloud Run để cookie session hoạt động cùng origin.
- Staging có access gate: Vercel Preview chèn header bí mật; Cloud Run staging so sánh header với Secret Manager và chặn API nếu thiếu/sai khóa. Chỉ `/api/health` được mở cho smoke test. Bật thêm Vercel Preview Deployment Protection cho người QA.
- VM/GPU/Triton không tham gia deploy web/API hiện tại.

## Luồng triển khai

```text
feature/* → PR dev → CI → merge dev
                         ├─ Vercel Preview → Cloud Run staging
                         └─ QA thủ công
                               ↓ PR dev → main, review/approval
                         Vercel Production → Cloud Run production
```

CI trên PR chạy Ruff, Mypy, pytest, Python compile, frontend tests/build. Docker image được build trong deploy job sau khi merge/push vào `dev` hoặc `main`; nếu build thất bại thì deploy dừng và revision đang phục vụ giữ nguyên. Như vậy PR không cần credential GCP/Docker Hub, còn image đúng với commit được deploy.

Dockerfile currently uses `mirror.gcr.io/library/node:24-alpine` and `mirror.gcr.io/library/python:3.12-slim` for the Node/Python base images. Both images were successfully pulled from the Google mirror locally on 2026-10-10. This avoids the direct Docker Hub login/token call that was timing out. Google mirror only retains frequently requested images and can evict them; it does not guarantee every tag remains available. If a future build reports a mirror miss, retry later or move to another trusted upstream.

**Remote repository attempt:** `dockerhub-cache` was created in Artifact Registry and configured with Secret Manager secret `dockerhub-upstream-token`; staging deployer Reader and Artifact Registry service-agent Secret Accessor were granted. However, pulls returned `504 Gateway Timeout`, and repository updates failed while validating `https://auth.docker.io/token`. Therefore the workflow does not use this remote repository or require a GitHub variable for it right now. Do not reuse this Docker Hub credential as `KNEE_STAGING_GATE_TOKEN`.

Artifact Registry standard repository `knee-review` chứa image ứng dụng `knee-review-api:<commit-sha>` để Cloud Run chạy. Các base images hiện lấy từ Google-managed mirror `mirror.gcr.io`, nên workflow chỉ cần deployer quyền Writer trên `knee-review`; không cần remote-repository Environment variable hay Reader role trên `dockerhub-cache` cho CI.

### Remote repository — deferred

The custom remote repository is currently retained but unused. Its first upstream fetch is timing out at Docker Hub's token endpoint; platform-log configuration also fails because Artifact Registry validates the upstream during the update. Do not add `AR_DOCKERHUB_REMOTE_REPOSITORY` to GitHub Environments. If this route is revisited, check current upstream connectivity first; see Google's [remote repository troubleshooting](https://cloud.google.com/artifact-registry/docs/troubleshoot-remote).

Cloud Run deploy dùng image tag bất biến theo commit SHA, tạo revision với `--no-traffic`, rồi gọi `/api/health` qua URL candidate. Chỉ khi JSON health hợp lệ thì workflow mới chuyển traffic sang revision mới. Nếu build/deploy/smoke test lỗi, revision cũ tiếp tục nhận traffic. Đây là promote gate tự động; không phải Cloud Run tự phát hiện mọi lỗi sau phát hành hay tự rollback sau khi đã chuyển traffic. Rollback hậu triển khai vẫn là thao tác thủ công tới revision cũ.

## Công việc GCP phải làm một lần trước khi bật CD

Workflow đã được thêm vào `.github/workflows/ci.yml`, nhưng sẽ dừng sớm cho tới khi tạo GitHub Environments và cấu hình IAM bên dưới. Workflow không tự tạo/xóa tài nguyên GCP; không lưu service-account key JSON.

### Tài nguyên độc lập theo môi trường

| | Staging (`dev`) | Production (`main`) |
|---|---|---|
| Cloud Run service | `knee-review-api-staging` | `knee-review-api-production` |
| Firestore database | `(default)` hiện có | `knee-review-production` |
| GCS bucket | `rsna-knee-dicom-preview-511004` hiện có | Tạo riêng, ví dụ `rsna-knee-dicom-production-511004` |
| Runtime service account | `knee-review-api@rsna-knee-511004.iam.gserviceaccount.com` hiện có | Tạo `knee-review-api-production@rsna-knee-511004.iam.gserviceaccount.com` |
| Staging access gate | Secret Manager secret `knee-review-staging-gate` | Không dùng |
| Dữ liệu | Chỉ dữ liệu đã de-identify dùng QA | Bucket private và retention có chủ đích |

Cloud Run service hiện có tên `knee-review-api` **không bị workflow ghi đè**. Giữ nó nguyên trạng tới khi staging/prod mới được xác nhận; sau đó cập nhật Vercel Production URL sang service production mới. Quan trọng: runtime SA `knee-review-api@...` hiện đang có `roles/datastore.user` không-condition ở project scope. Trước khi đưa production database vào dùng, cấp binding có condition chỉ cho `projects/rsna-knee-511004/databases/(default)` rồi gỡ binding rộng đó; production SA chỉ được cấp condition cho `projects/rsna-knee-511004/databases/knee-review-production`. Như vậy staging/legacy runtime không thể đọc metadata production. Staging runtime chỉ cần `(default)`; production runtime chỉ cần `knee-review-production`. Tham khảo [Firestore per-database IAM](https://cloud.google.com/firestore/docs/manage-databases#configure_per-database_access_permissions).

**Đã tạo Artifact Registry:** repository `knee-review`, Docker/Standard, region `asia-southeast1`, URI `asia-southeast1-docker.pkg.dev/rsna-knee-511004/knee-review`. Tại lần kiểm tra 2026-10-10 repo còn 0 MB; mã hóa Google-managed. Vulnerability scanning đang tắt vì `containerscanning.googleapis.com` chưa bật. Repository `cloud-run-source-deploy` là repo riêng do Cloud Run source deployment tạo, không phải repo `knee-review` dùng cho workflow CD.

**Còn cần làm:** tạo hai deployer service accounts (staging/production) và Workload Identity Federation pool/provider dành riêng repo `nguyen1oc/RNSA_knee_web_service`; không tạo JSON key. Mỗi deployer cần quyền push image, deploy/update Cloud Run service tương ứng, và `iam.serviceAccountUser` chỉ trên runtime service account tương ứng. Production GitHub Environment phải yêu cầu reviewer approval. Có thể bật vulnerability scanning sau nếu muốn quét image; việc này không chặn workflow CD hiện tại.

Tạo Secret Manager secret `knee-review-staging-gate` với chuỗi ngẫu nhiên mạnh; cấp `roles/secretmanager.secretAccessor` trên secret đó cho staging runtime SA. GitHub Environment `staging` chỉ cần biến `STAGING_GATE_SECRET_NAME=knee-review-staging-gate` (tên secret, không phải giá trị).

### GitHub Environment variables

Trong GitHub repository → **Settings → Environments**, tạo `staging` và `production`. Thêm các biến dưới đây vào từng environment. Với `production`, giới hạn deployment branch chỉ `main` và bật Required reviewers.

```text
GCP_PROJECT_ID=rsna-knee-511004
GCP_REGION=asia-southeast1
AR_REPOSITORY=knee-review
CLOUD_RUN_SERVICE=knee-review-api-staging          # production: knee-review-api-production
CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT=...iam.gserviceaccount.com
DICOM_BUCKET=rsna-knee-dicom-preview-511004         # production: bucket riêng
FIRESTORE_DATABASE=(default)                       # production: knee-review-production
CORS_ALLOWED_ORIGINS=https://<stable-staging-origin> # production origin tương ứng
WIF_PROVIDER=projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>
WIF_SERVICE_ACCOUNT=<deployer>@rsna-knee-511004.iam.gserviceaccount.com
STAGING_GATE_SECRET_NAME=knee-review-staging-gate  # staging only
```

`WIF_PROVIDER` là resource name đầy đủ; `WIF_SERVICE_ACCOUNT` là email deployer. WIF attribute condition phải giới hạn đúng repository và ref: staging chỉ `refs/heads/dev`, production chỉ `refs/heads/main`. Không trao quyền deploy cho fork PR.

### Vercel frontend routing

`knee-web/frontend/vercel.ts` tạo rewrite same-origin từ `/api/*` tới `KNEE_API_ORIGIN`. Trong Vercel project → **Settings → Environment Variables**:

- `KNEE_API_ORIGIN`: Preview = URL Cloud Run staging; Production = URL Cloud Run production.
- `KNEE_STAGING_GATE_TOKEN`: Preview = cùng giá trị lưu trong Secret Manager `knee-review-staging-gate` (đánh dấu Sensitive/Secret). Production không dùng gate; nếu cần khai báo biến cho cả environments, đặt chuỗi placeholder không bí mật vì production API bỏ qua header này.
- `VITE_API_BASE_URL`: để trống để giữ same-origin rewrite.
- `VITE_DIRECT_GCS_UPLOAD`: `true` cho Preview và Production.
- Bật Preview Deployment Protection; giới hạn QA vào Preview từ branch `dev` hoặc alias/domain staging ổn định để cấu hình CORS GCS. Production chỉ theo `main`.

Sau khi sửa environment variables, redeploy frontend để build config mới. CORS của Cloud Run và GCS phải cho phép đúng stable Preview và Production origins, không mở wildcard rộng tùy tiện. API rewrite không proxy DICOM bytes; browser vẫn upload trực tiếp resumable tới private GCS.

## Sau khi cấu hình

1. Mở PR cập nhật vào `dev`; xác nhận CI xanh.
2. Merge vào `dev`; GitHub Environment `staging` deploy candidate, health-check thành công rồi mới nhận traffic.
3. Mở Vercel Preview deployment từ branch `dev`; kiểm tra `/api/health`, tạo session, import study đã de-identify, xem slices, refresh, xóa study và xác nhận cookie/session.
4. Khi QA đạt, mở PR `dev → main`; production Environment yêu cầu approval.
5. Merge `main`; workflow deploy production theo quy trình candidate → smoke test → promote. Xác nhận Vercel Production trỏ đúng Cloud Run production và kiểm tra public URL.

## Rollback và giới hạn

- **Trước promote:** candidate lỗi thì traffic cũ không đổi, không cần rollback.
- **Sau promote:** Cloud Run giữ revision cũ nhưng không tự chuyển traffic lại chỉ vì health/metric về sau xấu. Rollback thủ công trong Console hoặc `gcloud run services update-traffic ... --to-revisions REVISION=100`.
- Có thể nâng cấp thành canary (ví dụ 5% → 25% → 100%) với metric/error-rate verification và rollback automation. Chưa bật trong workflow đơn giản này.
- Không chạy migration phá ngược schema trong cùng deploy. Firestore database riêng giúp cô lập data; đổi schema cần tương thích ngược trước khi rollout.
- Test fake Firestore/GCS không thay thế integration test thật. Chỉ dùng study đã de-identify; đây là research viewer, không phải thiết bị chẩn đoán lâm sàng.

## Kiểm tra local

```powershell
cd knee-web
python -m ruff check backend
python -m mypy backend
python -m pytest -q
cd frontend
npm ci
npm test
npm run build
```
