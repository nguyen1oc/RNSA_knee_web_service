# Upload và MRI Volume: cải thiện và cách đo

## Thay đổi trong ứng dụng

- Trong lúc chuẩn bị hoặc truyền dữ liệu, nút **Cancel** dừng việc đọc/đóng gói file hoặc truyền file. Với upload Cloud Storage, trình duyệt gọi API xóa object tạm `incoming/` và metadata của upload; nếu không dọn được ngay, lifecycle của bucket là lớp dự phòng. Khi backend đã bắt đầu **Indexing**, nút hủy bị khóa vì server có thể đã nhận đủ file và đang tạo study.
- Khi import, backend lưu kết quả `volume_eligibility` cùng metadata của series. Những series cũ chưa có cache được kiểm tra một lần rồi lưu lại. Các lần mở MRI Volume sau đó không cần tải header từng lát từ GCS để chạy lại kiểm tra.
- `DIRECT_GCS_DICOM_READS` là cờ thử nghiệm, mặc định tắt. Khi bật, API kiểm tra quyền session trước, sau đó cấp URL GCS chỉ đọc, hết hạn sau 10 phút. URL là bearer credential: không ghi URL vào log, ticket hay chia sẻ ra ngoài. Nếu ký URL lỗi, app tự quay lại tải qua API.
- Log `upload_timing` phân biệt validate, tải ZIP tạm về, lưu từng DICOM vào GCS và commit metadata. Trình duyệt ghi `[upload_timing]` cho bước chuẩn bị/đóng gói và truyền file. Các log không chứa Study UID, tên file hoặc nội dung DICOM.

## Bật tải DICOM trực tiếp ở staging để so sánh

Đây là bước cấu hình GCP thủ công; code không tự cấp thêm IAM quyền. Cần bật IAM Service Account Credentials API và cho runtime service account ký URL bằng chính danh tính đó:

```powershell
$project = "rsna-knee-511004"
$runtime = "knee-review-api@rsna-knee-511004.iam.gserviceaccount.com"
gcloud services enable iamcredentials.googleapis.com --project=$project
gcloud iam service-accounts add-iam-policy-binding $runtime `
  --project=$project `
  --member="serviceAccount:$runtime" `
  --role="roles/iam.serviceAccountTokenCreator"
```

Sau khi cập nhật `templates/gcs-cors.json` vào staging bucket, bật `DIRECT_GCS_DICOM_READS=true` trên **Cloud Run staging** rồi deploy revision mới. Chỉ thử trên staging và study mẫu. Production vẫn giữ proxy mặc định cho tới khi so sánh xong. Để tắt, đặt biến này thành `false` hoặc xóa biến rồi deploy lại.

Thời hạn URL 10 phút; quyền đọc vẫn bị giới hạn theo object và runtime service account. Ai lấy được URL có thể tải đúng object trong khoảng thời gian đó, nên không gửi URL trong log hoặc ảnh chụp màn hình.

## Đo k6 trên staging

Script `knee-web/scripts/k6/staging-volume.js` tạo session riêng cho từng VU, chỉ đọc example study, gọi `/api/series/{id}/volume` và tải một lát DICOM nếu series đủ điều kiện. Script từ chối mọi host không phải Cloud Run staging; không gọi Analyze, upload hay delete.

```powershell
$env:API_BASE_URL = "https://knee-review-api-staging-jnbsqra6ma-as.a.run.app"
$env:STAGING_ORIGIN = "https://rnsa-knee-web-service-git-dev-locntmasterc-5002s-projects.vercel.app"
$env:KNEE_STAGING_GATE_TOKEN = (gcloud secrets versions access latest --secret=knee-review-staging-gate --project=rsna-knee-511004 | Out-String).Trim()

k6 run --summary-export .\volume-1vu.json `
  --env API_BASE_URL=$env:API_BASE_URL `
  --env STAGING_ORIGIN=$env:STAGING_ORIGIN `
  --env KNEE_STAGING_GATE_TOKEN=$env:KNEE_STAGING_GATE_TOKEN `
  --env VUS=1 --env ITERATIONS_PER_VU=3 `
  .\knee-web\scripts\k6\staging-volume.js
```

Chạy trước với proxy (`DIRECT_GCS_DICOM_READS=false`), sau đó bật direct GCS và chạy lại cùng study/VU. So sánh `volume_request_duration`, `dicom_first_slice_duration`, lỗi và Cloud Run request logs trong cùng khung giờ. Sau khi xong, xóa token khỏi PowerShell:

```powershell
$env:KNEE_STAGING_GATE_TOKEN = $null
```

Ghi chú CORS, nếu cần bật tải trực tiếp ở staging: chạy ở thư mục repository chứa `knee-service-blueprint/`:

```powershell
gcloud storage buckets update "gs://rsna-knee-dicom-preview-511004" `
  --cors-file="knee-service-blueprint/templates/gcs-cors.json"

gcloud run services update knee-review-api-staging `
  --project=rsna-knee-511004 `
  --region=asia-southeast1 `
  --update-env-vars=DIRECT_GCS_DICOM_READS=true
```

Chạy lại cùng bài k6 để so sánh. Tắt thử nghiệm bằng `--update-env-vars=DIRECT_GCS_DICOM_READS=false`. Không thêm biến này vào production cho tới khi có kết quả và đã duyệt thay đổi.

## Baseline đã đo

Ngày 13/10/2026, service `knee-review-api-staging-00030-jaf`, proxy mode, example study, k6 2.2.0:

| Lượt | Tải | `/volume` p95 | Tải 1 DICOM p95 | Lỗi |
| --- | --- | ---: | ---: | ---: |
| AX đầu tiên trong lượt này | 1 VU × 1 | 5,09 giây* | 2,59 giây* | 0/4 request |
| AX lặp lại | 1 VU × 3 | 383 ms | 2,65 giây | 0/12 request |
| Series mặc định đã ấm | 1 VU × 3 | 235 ms | 2,72 giây | 0/12 request |

`*` Chỉ có một mẫu, không phải percentile đáng tin. Script đầu tiên có lỗi ghép URL proxy; lượt lỗi đó đã làm ấm cache server. Vì vậy hàng AX đầu tiên là lượt đầu đo AX, nhưng không được khẳng định là cache-cold tuyệt đối của cả service. Hàng AX warm dùng cùng series sau lượt đầu. Các lần chạy chỉ tải một DICOM mỗi vòng; thời gian mở xong toàn bộ MRI Volume trên browser sẽ lâu hơn và cần đo riêng.

Kết quả hiện tại cho thấy `/volume` có thể dao động mạnh giữa lần đọc header từ GCS và lần đã ấm; tải một file DICOM qua API khoảng 2,6–2,7 giây ở các lượt này. Đây là mốc trước khi cache geometry và thử direct GCS được bật. Chưa chạy 2/5 VU vì muốn kiểm tra bản tối ưu trước.

Summary JSON: [lượt AX đầu](benchmarks/2026-10-13-staging-volume-baseline-proxy/cold-axial/k6-summary.json), [AX warm](benchmarks/2026-10-13-staging-volume-baseline-proxy/warm-axial-1vu/k6-summary.json), [series warm ban đầu](benchmarks/2026-10-13-staging-volume-baseline-proxy/k6-summary.json).

Đây là phép đo API và tải một file DICOM, không đo thời gian giải mã 3D/canvas trên điện thoại. Muốn so sánh thời gian MRI Volume hoàn tất trong browser, mở DevTools → Network/Performance và ghi lại cùng một study, một thiết bị, lượt đầu và lượt lặp lại.

## Thứ tự ramp-up

1. Một VU × 3 lượt để xác nhận session, cache hit và đọc DICOM.
2. Nếu không lỗi, hai VU × 2 lượt.
3. Chỉ sau đó mới thử năm VU × 2 lượt.

Dừng nếu xuất hiện timeout/5xx, lỗi tăng, hoặc thời gian tăng mạnh. Bài này không gọi inference GPU và không chứng minh số người dùng tối đa. Chưa tăng Cloud Run concurrency hoặc max instances trong lần kiểm tra này.

## Đọc log theo giai đoạn

Trong Logs Explorer, lọc Cloud Run service staging rồi tìm `upload_timing` hoặc `volume_timing`. `volume_timing` có `cache_hit=true/false`, số lát, đường tải proxy/direct và tổng thời gian kiểm tra. Trên trình duyệt tìm `[upload_timing]` để tách thời gian đóng gói và truyền ZIP. Không chia sẻ cookie, signed URL hoặc token khi gửi log cho người khác.
