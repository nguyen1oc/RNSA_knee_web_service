# 19 — Cách ứng dụng chạy trên Vercel và Google Cloud

> **Cập nhật:** 13/10/2026. Trang này mô tả kiến trúc public và cách dữ liệu đi qua hệ thống. Trạng thái revision, workflow và các điểm chưa xác minh nằm ở [21 — tài liệu bàn giao](21-project-handover.md).

## Ứng dụng gồm những phần nào?

| Thành phần | Vai trò |
| --- | --- |
| Vercel | Phục vụ giao diện React và HTTPS. |
| FastAPI trên Cloud Run | Quản lý temporary session, kiểm tra quyền của session, đọc metadata, chuẩn bị DICOM và gọi model. |
| Firestore | Lưu thông tin session/study và các bộ đếm dùng chung giữa API instances. |
| Cloud Storage | Lưu file DICOM trong bucket riêng tư. Trình duyệt upload trực tiếp bằng resumable upload. |
| Triton trên Cloud Run GPU | Nạp checkpoint và chạy model; chỉ API được phép gọi service này. |

```text
Browser → Vercel → /api → FastAPI / Cloud Run
                             ├─ Firestore: session và study metadata
                             ├─ Cloud Storage: DICOM riêng tư
                             └─ Triton / Cloud Run GPU: model inference
```

Vercel không chạy FastAPI. Vercel rewrite `/api/*` sang Cloud Run để trình duyệt gọi cùng origin; điều này giúp cookie session hoạt động nhất quán. File DICOM lớn đi thẳng từ browser đến Cloud Storage, không đi qua Vercel hay request body của Cloud Run.

## Khi người dùng nhập một study

1. Trình duyệt yêu cầu API tạo temporary session. API trả HttpOnly cookie; người dùng không cần tạo tài khoản.
2. Trình duyệt yêu cầu API tạo resumable upload session, sau đó gửi file theo chunk trực tiếp tới bucket riêng tư.
3. Khi upload xong, API kiểm tra object, giải nén/kiểm tra DICOM, nhóm file theo Study/Series UID và ghi metadata vào Firestore.
4. Khi người dùng xóa study hoặc session hết hạn, backend xóa object DICOM trước rồi mới xóa metadata. Nếu xóa object lỗi, metadata được giữ lại để có thể retry.

Study của người dùng được gắn với temporary session. Shared example study là dữ liệu mẫu dùng chung, chỉ đọc và không bị thao tác Clear session xóa. Session không phải tài khoản lâu dài: người dùng cần tải dữ liệu cần giữ về máy trước khi session hết hạn.

## Khi người dùng bấm Analyze

FastAPI kiểm tra session và study, lấy DICOM từ Cloud Storage, chọn series và tạo tensor theo model contract. Sau đó API gọi Triton bằng danh tính dịch vụ GCP. Triton trả 12 scores; API gửi kết quả về giao diện. Người dùng không gửi checkpoint lên web.

Scores hiện là sigmoid model scores, chưa được calibration và không phải xác suất chẩn đoán. Chúng chỉ để tham khảo; bác sĩ chịu trách nhiệm diễn giải.

## Staging và production

| | Staging | Production |
| --- | --- | --- |
| Mục đích | QA nội bộ trước khi phát hành | Bản public cho người dùng |
| Nhánh | `dev` | `main` |
| Frontend | Vercel Preview | Vercel Production: `https://rnsa-knee-web-service.vercel.app/` |
| API Cloud Run | `knee-review-api-staging` | `knee-review-api-production` |
| Firestore | `(default)` | `knee-review-production` |
| Bucket DICOM | `rsna-knee-dicom-preview-511004` | `rsna-knee-dicom-production-511004` |
| Staging gate | Có; chỉ dành cho Preview/QA | Không dùng |

Người dùng đã xác nhận staging Analyze hoạt động qua Triton và báo production cũng đã được nối, kiểm tra. Cấu hình live có thể đổi; trước release hãy kiểm tra traffic/revision trong Cloud Run và `KNEE_API_ORIGIN` trong Vercel.

## Dữ liệu và thời gian lưu

- Bucket DICOM là private; bật Uniform bucket-level access và Public access prevention.
- Bucket có soft delete 7 ngày theo lần kiểm tra được ghi nhận. Xóa trong app làm object biến mất khỏi vùng đang dùng, nhưng bản soft-deleted có thể khôi phục trong thời gian retention và có thể phát sinh phí lưu trữ.
- Lifecycle rule chỉ dọn prefix `incoming/` sau một ngày; không áp dụng quy tắc xóa theo tuổi lên study đang hoạt động.
- Session có giới hạn idle 60 phút và tối đa 4 giờ theo cấu hình ứng dụng. Cleanup cần xóa DICOM trước metadata.
- Firestore TTL phù hợp để dọn rate-limit counters; không dùng TTL để xóa study metadata trước khi xóa object GCS.

Source có endpoint cleanup được bảo vệ bằng OIDC. Tuy nhiên, cần kiểm tra Cloud Scheduler job, executions và log để xác nhận lịch cleanup thật sự đã bật ở từng môi trường. Endpoint trong code không tự chạy theo lịch.

## Giới hạn upload và chống lạm dụng

Cấu hình ứng dụng hiện hướng tới các giới hạn sau:

| Thao tác | Giới hạn dự kiến |
| --- | --- |
| Tạo temporary session | 10 lần/10 phút và 30 lần/ngày theo IP đáng tin cậy |
| Khởi tạo upload | 5 lần/phút, 30 lần/giờ/session; tối đa 3 upload đang chờ |
| Finalize upload | 3 lần/10 phút/session |
| Dữ liệu | Tối đa 600 MiB mỗi request, 800 MiB giải nén/session, 200 MiB mỗi DICOM và 500 DICOM/session |

Không tin `X-Forwarded-For` do client tự gửi. Chỉ dùng IP khi request chắc chắn đi qua proxy tin cậy và direct bypass đã bị chặn. Cần kiểm tra Vercel/edge rule và backend counters thực tế trước khi tuyên bố giới hạn theo IP đang có hiệu lực. Cloud Run `max instances` và concurrency giới hạn tài nguyên; chúng không thay thế rate limit.

## Luồng phát hành

1. Tạo feature branch và mở PR vào `dev`.
2. CI chạy lint, type-check, test và build. Khi merge vào `dev`, GitHub Actions deploy API staging; Vercel tạo Preview.
3. QA kiểm tra staging: health, session, upload/view/delete và Analyze bằng study đã de-identify.
4. Mở PR `dev` vào `main`; reviewer kiểm tra và duyệt.
5. Khi merge `main`, workflow deploy production theo Environment đã cấu hình. Vercel Production cũng cập nhật từ `main`.

Workflow API dùng Workload Identity Federation thay vì service-account key JSON. CI có bước health-check trước khi promote revision ở các lần deploy đã có service. Nếu lỗi xuất hiện sau khi promote, Cloud Run không tự rollback; xem [15 — CI/CD](15-ci-cd-plan.md).

**Đối chiếu gần nhất:** workflow trên `origin/dev` (`759c0fb`) và `origin/main` (`07d5f0d`) đã truyền cấu hình Triton riêng theo từng GitHub Environment. Ngày 13/10, hai API và hai Triton service đều có revision sẵn sàng; cả hai API trả health `ok`, Triton production nhận 100% traffic. Checkout local đang mở là branch cũ, nên không dùng workflow local để suy ra trạng thái hai branch mới nhất. Health check chưa thay thế lượt Analyze end-to-end trên production.

## Trước khi chia sẻ rộng

- Dùng dữ liệu đã de-identify; không upload DICOM có thông tin nhận dạng bệnh nhân.
- Kiểm tra API và Triton production đang nhận traffic từ đúng revision.
- Kiểm tra Cloud Scheduler cleanup, Firestore TTL, rate-limit counters và edge protection.
- Kiểm tra budget alert, quota, bucket retention và log xóa object.
- Chạy bài tải theo từng bước, ghi p95/lỗi/GPU/chi phí; không suy ra số người dùng tối đa từ một bài test nhỏ.
- Nêu rõ đây là research viewer, không phải thiết bị chẩn đoán lâm sàng.

## Tài liệu liên quan

- [15 — CI/CD, approval và rollback](15-ci-cd-plan.md)
- [20 — Triton trên Cloud Run GPU](20-triton-cloudrun-gpu.md)
- [21 — tài liệu bàn giao](21-project-handover.md)
- [Benchmark/k6](benchmarks/README.md)
