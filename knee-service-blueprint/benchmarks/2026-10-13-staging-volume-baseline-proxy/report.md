# Baseline MRI Volume staging — API proxy

- Ngày: 13/10/2026
- Service revision: `knee-review-api-staging-00030-jaf`
- k6: 2.2.0
- Nguồn dữ liệu: example study; không dùng DICOM người bệnh
- Luồng: Cloud Run API proxy; chưa bật signed URL/direct GCS
- Phạm vi: tạo session, lấy series của example study, gọi volume eligibility, tải một DICOM đầu tiên
- Không gọi Analyze, không upload và không xóa study

| Lượt | Tải | `/volume` p95 | DICOM đầu tiên p95 | HTTP lỗi |
| --- | --- | ---: | ---: | ---: |
| AX, lượt đo đầu tiên | 1 VU × 1 | 5,09 giây* | 2,59 giây* | 0/4 |
| AX, lặp lại | 1 VU × 3 | 383 ms | 2,66 giây | 0/12 |
| Series mặc định đã ấm | 1 VU × 3 | 235 ms | 2,72 giây | 0/12 |

`*` Chỉ có một mẫu nên p95 ở đây bằng thời gian mẫu duy nhất, không đại diện cho phân phối. Một lượt k6 trước đó gặp lỗi trong harness khi ghép URL proxy; request đó đã có thể làm ấm cache. Vì vậy lượt AX đầu tiên là lượt đo đầu tiên cho series AX, không khẳng định cache toàn service còn lạnh.

Kết quả cho thấy lần kiểm tra AX đầu tiên chậm hơn các lần lặp sau. Thời gian tải một DICOM qua API vẫn khoảng 2,6–2,7 giây ở các lượt đo này. Mẫu quá nhỏ để kết luận latency ổn định hay năng lực chịu tải; đây chỉ là mốc đối chiếu trước khi bật các tối ưu.

## Dữ liệu thô

- [Series mặc định đã ấm](k6-summary.json)
- [AX, lượt đo đầu tiên](cold-axial/k6-summary.json)
- [AX, lượt lặp lại](warm-axial-1vu/k6-summary.json)

## Giới hạn

- Chỉ có một VU; chưa phải bài stress/load test và không chứng minh số người dùng tối đa.
- Mỗi iteration tải một file DICOM, không đo thời gian tải, giải mã và dựng xong toàn volume trên trình duyệt.
- Đây là proxy baseline. Chưa có số đo đối chứng sau khi bật cache mới hoặc direct GCS.
- Chưa tăng Cloud Run concurrency/max instances và chưa thay đổi cấu hình cloud trong bài test này.
