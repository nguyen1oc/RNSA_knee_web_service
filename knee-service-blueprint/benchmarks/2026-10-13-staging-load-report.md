# Báo cáo kiểm tra tải staging — 13/10/2026

## Phạm vi kiểm tra

- Môi trường: Cloud Run staging API và Triton.
- Dữ liệu: study mẫu `sample-knee`; không upload/xóa DICOM và không gửi request tới production.
- Công cụ: k6 2.2.0 chạy trên máy phát triển.
- Revision API được ghi nhận: `knee-review-api-staging-00024-teq`.
- Revision Triton được ghi nhận: `knee-triton-staging-00001-tzw`.
- Khi kiểm tra, API và Triton đều có concurrency 1 và giới hạn service tối đa 1 instance. API revision có annotation `maxScale=6`, nhưng service-level maximum vẫn là 1.

## Kết quả

| Bài kiểm tra | Số lượt Analyze | VU tối đa | p50 Analyze | p95 Analyze | Lâu nhất | Lỗi |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Lượt đầu tiên / có thể gồm khởi động | 1 | 1 | 45,09 giây | 45,09 giây* | 45,09 giây | 0 |
| Warm, chạy tuần tự | 5 | 1 | 2,25 giây | 2,60 giây | 2,62 giây | 0 |
| Burst ngắn | 4 | 2 | 3,18 giây | 4,54 giây | 4,77 giây | 0 |
| Burst ngắn | 10 | 5 | 9,44 giây | 10,38 giây | 10,91 giây | 0 |

Các lượt Analyze thành công đều trả HTTP 200 và đủ 12 scores. Health check riêng trả HTTP 200 cho cả 3 request; p95 là 124 ms.

`*` Chỉ có một mẫu nên p95 bằng chính thời gian của mẫu đó; không thể xem đây là percentile có ý nghĩa thống kê. Các bài kiểm tra này chỉ để thăm dò, chưa phải benchmark capacity.

## Ý nghĩa và giới hạn

- Luồng staging hoạt động từ tạo temporary session, tìm study mẫu, gọi Analyze đến trả đủ 12 scores.
- Khi tăng từ 1 lên 2 rồi 5 VU, thời gian chờ tăng rõ. Các lượt trong bài nhỏ này không lỗi. Kết quả phù hợp với khả năng request phải chờ vì API/Triton đang giới hạn concurrency 1, nhưng chưa chứng minh chính xác bottleneck nằm ở đâu.
- Bài 5 VU chỉ chứng minh 10 lượt Analyze trong một burst ngắn đã hoàn tất. Nó **không** chứng minh 5 người dùng đồng thời có trải nghiệm tốt và cũng không xác định số người dùng tối đa.
- Script đợi một giây giữa các lượt của mỗi VU. Vì vậy, đây không phải bài test gửi tải liên tục tới khi hệ thống bão hòa.
- Bài kiểm tra không ghi lại GPU utilization/memory hoặc Cloud Run instance/queue metrics cùng thời điểm. Báo cáo không đưa ra kết luận về dư địa GPU hay chi phí khi tăng tải.
- Lượt đầu mất 45,09 giây. Thời gian này có thể gồm cold start hoặc nạp model; chưa tách riêng được nên chỉ gọi là “lượt đầu”, không khẳng định đó là cold-start thuần túy.
- Một lần chạy thử ban đầu bị lỗi session cookie do test script không gửi cookie cho mọi lượt. Script đã được sửa để gửi cookie rõ ràng; kết quả 1/2/5 VU trong bảng là các lần chạy sau khi sửa. Lần lỗi ban đầu không được tính vào bảng.

## File kết quả

- [Health check](2026-10-13-staging-health/k6-summary.json)
- [Lượt Analyze đầu](2026-10-13-staging-cold-first/k6-summary.json)
- [Warm, 1 VU](2026-10-13-staging-warm-1vu/k6-summary.json)
- [2 VU](2026-10-13-staging-2vu/k6-summary.json)
- [5 VU](2026-10-13-staging-5vu/k6-summary.json)
- [Script và cách chạy](README.md)

## Bước đo tiếp theo

Trước khi tăng concurrency hoặc giới hạn instance, hãy chạy bài warm lâu hơn và cùng lúc ghi latency, số instance, CPU/RAM, GPU utilization/memory và lỗi của cả API lẫn Triton. Sau đó tăng tải từng bước, so sánh latency/lỗi/chi phí và giữ giới hạn hiện tại nếu chưa có bằng chứng đủ tốt để đổi.
