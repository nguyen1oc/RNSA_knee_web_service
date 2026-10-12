# Knee Review — tài liệu bàn giao

> Cập nhật: 13/10/2026. Đã đối chiếu GitHub `origin/dev`/`origin/main` và trạng thái Cloud Run ngày 13/10/2026. Đọc trang này trước khi làm theo các hướng dẫn triển khai cũ.

## Dự án này làm gì?

Knee Review là ứng dụng web nghiên cứu để nhập và xem MRI đầu gối, sau đó chạy model AI để trả về 12 điểm dự đoán cho một study. Kết quả chỉ để tham khảo; điểm số chưa được hiệu chỉnh để thành xác suất bệnh và không thay thế kết luận của bác sĩ.

## Các phần chính

```text
Trình duyệt
  ├─ Frontend React trên Vercel
  └─ /api → FastAPI trên Cloud Run
              ├─ Firestore: session và thông tin study
              ├─ Cloud Storage: file DICOM riêng tư
              └─ Triton trên Cloud Run GPU: chạy model và trả 12 scores
```

Khi người dùng bấm Analyze, FastAPI kiểm tra session và study, đọc DICOM đã lưu, chọn series và chuẩn bị tensor. FastAPI gửi tensor tới Triton; Triton chạy checkpoint rồi trả scores về giao diện. Trình duyệt không gửi checkpoint lên server.

Bản Docker chạy trên máy phát triển vẫn dùng SQLite và filesystem. Vì vậy, kết quả và lưu trữ của bản local không đại diện cho cách Cloud Run lưu dữ liệu.

## Staging và production

| Môi trường | Dùng để làm gì? | Nguồn deploy |
| --- | --- | --- |
| Staging | Nhóm kiểm thử thủ công trước khi phát hành. Chỉ dùng dữ liệu đã de-identify. | Nhánh `dev` → Cloud Run staging; Vercel Preview trỏ về API staging. |
| Production | Bản public cho người dùng. Chỉ cập nhật sau khi staging được kiểm tra. | Nhánh `main` → Cloud Run production; Vercel Production trỏ về API production. |

Luồng phát hành là: tạo feature branch → mở PR vào `dev` → CI chạy → merge và kiểm tra staging → mở PR `dev` vào `main` → reviewer duyệt → merge và kiểm tra production. GitHub Actions dùng Workload Identity Federation (WIF), không cần lưu service-account key JSON trong GitHub.

Cloud Run giữ revision cũ, nhưng không tự rollback nếu lỗi chỉ xuất hiện sau khi đã chuyển traffic. Workflow hiện kiểm tra health trước khi promote ở các lần deploy đã có service; rollback sau promote vẫn cần thao tác thủ công.

## Trạng thái đã biết và giới hạn của bản bàn giao

- Staging và production đều có API và Triton service riêng. Ngày 13/10, Cloud Run báo API staging `knee-review-api-staging-00024-teq` và API production `knee-review-api-production-00004-biq` là revision mới nhất; cả hai API trả `/api/health` là `ok` và có cấu hình `TRITON_URL` trỏ đúng môi trường.
- Ngày 13/10, Triton staging `knee-triton-staging-00001-tzw` và production `knee-triton-production-00001-zwf` đều có trạng thái Cloud Run `Ready`, nhận 100% traffic và dùng startup probe `/v2/health/ready`. Điều này xác nhận service/model server sẵn sàng theo probe; không thay thế một lượt Analyze end-to-end mới trên từng môi trường.
- Ngày 13/10, `/api/health` trả `ok` qua cả domain Vercel Production lẫn URL trực tiếp của API production và staging. Health route chỉ xác nhận API phản hồi; chưa chạy Analyze production trong lượt kiểm tra này.
- Bài k6 staging đã chạy 5 Analyze tuần tự ở 1 VU (p95 khoảng 2,60 giây), 4 Analyze ở 2 VU (p95 khoảng 4,54 giây), và 10 Analyze ở 5 VU (p95 khoảng 10,38 giây). Các lượt này không lỗi, nhưng số mẫu nhỏ nên chưa chứng minh mức tải tối đa. Chưa ghi nhận mức sử dụng/bộ nhớ GPU cùng thời điểm.
- GitHub hiện có `origin/dev` tại `759c0fb` và `origin/main` tại `07d5f0d`. Hai nhánh đã có workflow Terraform tách theo môi trường và cấu hình Triton cho cả staging lẫn production. Checkout local đang mở vẫn là branch cũ `feat/terraform-staging-ci`; source local không đại diện cho hai branch mới nhất.
- Terraform có cấu hình staging và production trên `origin/dev`/`origin/main`. Workflow chỉ chạy `fmt`/`validate` cho đúng môi trường theo nhánh đích; workflow không chạy `plan` hay `apply`.
- **Lưu ý khi đọc source:** checkout local đang có nhiều thay đổi chưa commit. Muốn xem code mới nhất, đọc `origin/dev`/`origin/main` hoặc cập nhật branch trong checkout riêng; không checkout đè lên các thay đổi local hiện có.
- Chưa xác nhận đầy đủ việc Cloud Scheduler/Firestore TTL cleanup và toàn bộ rate-limit/edge protection đang bật ở production. Không ghi “đã bảo vệ/đã tự dọn” nếu chưa kiểm tra cấu hình và log thực tế.

## Cách kiểm tra trước khi nói hệ thống sẵn sàng

1. Xác nhận đúng branch, commit và GitHub Actions workflow đang dùng.
2. Trong Google Cloud Console, kiểm tra revision đang nhận traffic cho API và Triton. Lần kiểm tra 13/10 thấy API health `ok`, cả hai Triton service `Ready` và đều nhận 100% traffic.
3. Mở `/api/health`; sau đó chạy Analyze bằng study mẫu đã de-identify và xác nhận đủ 12 scores.
4. So sánh checkpoint SHA, thứ tự 12 target và output với contract trong [06 — AI/Triton](06-ai-triton-contract.md).
5. Với bài tải, ghi số request, tốc độ gửi, p50/p95, lỗi, Cloud Run instances, GPU utilization/memory và chi phí trong cùng khung giờ. Chỉ tăng tải từng bước; chưa có số đo thì không kết luận “chịu được X người dùng”.

## Tài liệu nên đọc theo thứ tự

1. [README của ứng dụng](../knee-web/README.md) — chạy và kiểm tra local.
2. [15 — CI/CD](15-ci-cd-plan.md) — nhánh, approval, deploy và rollback.
3. [19 — Public deployment](19-public-preview-deployment.md) — frontend, API, GCS và Firestore.
4. [20 — Triton trên Cloud Run GPU](20-triton-cloudrun-gpu.md) — model serving.
5. [06 — AI/Triton contract](06-ai-triton-contract.md) — input/output và giới hạn điểm số.
6. [Terraform staging](terraform/staging/README.md) — state, plan, apply và phạm vi tài nguyên.
7. [Benchmark instructions](benchmarks/README.md) và [kết quả staging](benchmarks/2026-10-13-staging-load-report.md).

Các tài liệu 00–18 còn lại gồm cả thiết kế ban đầu và kế hoạch theo từng giai đoạn. Khi nội dung của chúng khác trang bàn giao hoặc trạng thái trong code, không làm theo bước triển khai cũ trước khi đối chiếu với `dev`/`main`.
