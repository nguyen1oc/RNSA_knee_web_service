# Cách chạy và lưu bài kiểm tra tải

Thư mục này lưu hướng dẫn và kết quả từng lần chạy k6. Tạo một thư mục riêng cho mỗi lần test, ví dụ:

```text
benchmarks/
  2026-10-13-staging-1vu/
    report.md
    k6-summary.json
```

Mỗi báo cáo nên ghi ngày giờ, commit/revision, phiên bản k6, study mẫu, cấu hình Cloud Run, số VU và loại test (lượt đầu hay lượt warm). Không lưu staging gate token, cookie session, DICOM, hoặc thông tin nhận dạng bệnh nhân.

## Phạm vi an toàn

Các script ở `knee-web/scripts/k6/` chỉ chấp nhận host Cloud Run staging. Chúng không gửi request tới Vercel hay production. Script Analyze chỉ dùng study mẫu `sample-knee`; nó không upload hoặc xóa study. Mỗi lượt Analyze có thể phát sinh chi phí GPU, vì vậy bắt đầu với tải thấp.

## Cài k6 và chuẩn bị PowerShell

Nếu máy chưa cài k6:

```powershell
winget install k6 --source winget
```

Mở PowerShell mới và kiểm tra:

```powershell
k6 version
```

Khai báo URL staging và lấy gate token vào biến môi trường. Không in token ra màn hình, không dán vào script và không commit token:

```powershell
$env:API_BASE_URL = "https://knee-review-api-staging-jnbsqra6ma-as.a.run.app"
$env:STAGING_ORIGIN = "https://rnsa-knee-web-service-git-dev-locntmasterc-5002s-projects.vercel.app"
$env:KNEE_STAGING_GATE_TOKEN = (gcloud secrets versions access latest --secret=knee-review-staging-gate --project=rsna-knee-511004 | Out-String).Trim()
```

Nếu URL staging đã đổi, dùng URL hiện tại. Script từ chối host API không có dạng `knee-review-api-staging-*.a.run.app`.

## Chạy health check

Health check không tạo session và không gọi GPU. Tạo thư mục kết quả mới cho mỗi lần chạy:

```powershell
$run = "knee-service-blueprint/benchmarks/2026-10-13-staging-health"
New-Item -ItemType Directory -Force $run | Out-Null
k6 run --summary-export "$run/k6-summary.json" --env API_BASE_URL=$env:API_BASE_URL --env VUS=1 --env ITERATIONS=3 knee-web/scripts/k6/staging-health.js
```

## Chạy Analyze thử

Mỗi iteration gọi Analyze một lần. Bắt đầu bằng một lượt để kiểm tra end-to-end; sau đó chạy 1 VU rồi mới tăng lên 2 hoặc 5 VU. Tạo thư mục khác cho mỗi lệnh để không ghi đè kết quả:

```powershell
# Một lượt đầu tiên
$run = "knee-service-blueprint/benchmarks/YYYY-MM-DD-staging-first"
New-Item -ItemType Directory -Force $run | Out-Null
k6 run --summary-export "$run/k6-summary.json" --env API_BASE_URL=$env:API_BASE_URL --env VUS=1 --env ITERATIONS_PER_VU=1 knee-web/scripts/k6/staging-analyze.js

# Năm lượt tuần tự, sau lượt đầu
$run = "knee-service-blueprint/benchmarks/YYYY-MM-DD-staging-warm-1vu"
New-Item -ItemType Directory -Force $run | Out-Null
k6 run --summary-export "$run/k6-summary.json" --env API_BASE_URL=$env:API_BASE_URL --env VUS=1 --env ITERATIONS_PER_VU=5 knee-web/scripts/k6/staging-analyze.js

# Tăng tải từng bước; mỗi VU chạy hai lượt
$run = "knee-service-blueprint/benchmarks/YYYY-MM-DD-staging-2vu"
New-Item -ItemType Directory -Force $run | Out-Null
k6 run --summary-export "$run/k6-summary.json" --env API_BASE_URL=$env:API_BASE_URL --env VUS=2 --env ITERATIONS_PER_VU=2 knee-web/scripts/k6/staging-analyze.js

$run = "knee-service-blueprint/benchmarks/YYYY-MM-DD-staging-5vu"
New-Item -ItemType Directory -Force $run | Out-Null
k6 run --summary-export "$run/k6-summary.json" --env API_BASE_URL=$env:API_BASE_URL --env VUS=5 --env ITERATIONS_PER_VU=2 knee-web/scripts/k6/staging-analyze.js
```

Thay `YYYY-MM-DD` bằng ngày chạy thật. Mỗi VU đợi khoảng một giây giữa các iteration; cách chạy này phù hợp để thử luồng ngắn, nhưng không đo tải bão hòa hay số người dùng tối đa. Xem [báo cáo hiện có](2026-10-13-staging-load-report.md) để hiểu giới hạn của số đo.

## Xem metrics trên Google Cloud

Trong Google Cloud Console:

1. Mở **Cloud Run → Services**.
2. Chọn `knee-review-api-staging`, rồi mở **Metrics**. Lặp lại với `knee-triton-staging`.
3. Chọn đúng khoảng thời gian bài k6 chạy.
4. Ghi request latency, số instance, CPU/RAM, lỗi và GPU utilization/memory nếu chart có sẵn.
5. Mở **Logging → Logs Explorer**, lọc theo service name và cùng khoảng thời gian. Tìm `analysis_timing` và lỗi.

`analysis_timing` ghi thời gian tiền xử lý và vòng gọi API→Triton; đây không phải thời gian chạy GPU kernel thuần. So sánh số đó với thời gian Analyze phía k6 để tìm thời gian còn lại ở network, queue và các bước khác. Chưa đo GPU metrics thì không kết luận GPU còn dư hay đã đầy.

Không tăng concurrency hoặc số instance chỉ dựa trên một lần chạy. Thay đổi một cấu hình mỗi lần, chạy lại và so sánh latency, lỗi và chi phí.

Sau khi xong, xóa token khỏi session PowerShell:

```powershell
$env:KNEE_STAGING_GATE_TOKEN = $null
```
