# 18 — Anonymous temporary workspace

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Chốt chưa cần tài khoản; thêm session cookie cô lập dữ liệu, Clear session, TTL và giới hạn upload.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Quyết định sản phẩm

Bản review hiện tại không bắt người dùng tạo username/password. Ai mở trang cũng bắt đầu được một workspace tạm. Upload chỉ thuộc browser session đó; người khác không list/read/delete được study. Example study dùng chung, read-only. User bấm **Clear session** để xóa upload ngay; phiên idle hoặc quá thời gian tối đa sẽ hết hạn và được cleanup.

Đây không phải tài khoản, không có user profile, không đồng bộ study giữa thiết bị và không hứa lưu trữ lâu dài. Nếu sau này bác sĩ cần quay lại study, share study, audit hoặc lịch sử ca bệnh thì mới thiết kế account + persistent storage riêng.

## Cách session hoạt động

- `POST /api/sessions` cấp cookie ngẫu nhiên `knee_session`; cookie HttpOnly, SameSite=Lax, Secure khi HTTPS và chỉ gửi tới `/api`.
- Server chỉ lưu SHA-256 hash của token, không lưu token plaintext. Mỗi study upload có `owner_session_id`; mọi API list/detail/series/slice/DICOM/image/delete đều kiểm tra session đó.
- Mặc định hết hạn sau **60 phút không hoạt động**, tối đa **4 giờ** kể từ lúc mở. Có thể chỉnh bằng `SESSION_IDLE_TTL_MINUTES` và `SESSION_MAX_TTL_HOURS`.
- Nút **Clear session** gọi API xóa study + file của phiên ngay, thu hồi cookie, rồi mở phiên trống mới. Example không bị xóa.
- Expiry cleanup chạy lúc app khởi động và khi API nhận request tiếp theo. Trên VM, nếu không có request tiếp theo, file vật lý có thể đợi tới lần request/startup kế tiếp mới bị dọn; session hết hạn thì API đã từ chối truy cập.
- Cookie phiên được chia sẻ giữa tabs trong cùng browser profile. Dùng browser profile riêng nếu cần hai reviewer test đồng thời.
- Refresh trang không xóa workspace: cookie giữ session đến khi Clear session hoặc hết TTL. Session là theo browser profile, không đồng bộ qua thiết bị.
- Database migration không tự gán các upload cũ có `owner_uid` (từ prototype account) sang session mới; records/files cũ không xuất hiện trong workspace mới. Sao lưu volume cũ trước khi nâng cấp và xử lý dọn/migrate riêng, không tự động xóa dữ liệu.

## Giới hạn upload mặc định

Đã kiểm tra archive mẫu `results.zip`: khoảng **431 MiB nén**, **587 MiB bung**, **286 DICOM members**, DICOM lớn nhất khoảng **171 MiB**. Defaults có headroom nhưng vẫn chặn ZIP bất thường:

| Giới hạn | Mặc định |
|---|---:|
| Tổng request upload | 600 MiB |
| Tổng DICOM sau giải nén trong request | 800 MiB |
| Tổng study data trong một session | 800 MiB |
| Một DICOM member | 200 MiB |
| Số DICOM trong request | 500 |

Có thể chỉnh qua `MAX_UPLOAD_MIB`, `MAX_EXPANDED_MIB`, `MAX_SESSION_MIB`, `MAX_DICOM_FILE_MIB`, `MAX_DICOM_FILES`. ZIP được đọc/giải nén theo chunk xuống staging disk, không nạp nguyên archive vào Python memory; file member và tổng expanded bytes đều bị chặn. Tăng giới hạn chỉ sau khi đo RAM/disk với dữ liệu thật.

## Kiểm thử local/staging

```powershell
cd knee-web
docker compose up --build
```

Acceptance: mở workspace không đăng nhập; session A upload và xem; session B (browser profile khác) không thấy study A; A xóa study hoặc bấm Clear session thì file mất; example vẫn còn; idle/max TTL trả 401 và cleanup; upload qua từng cap trả HTTP 413 có thông báo; `results.zip` mẫu dưới cap vẫn ingest được. Compose lưu SQLite/files trên named volume cho staging/local, không phải cloud persistence.

Automated API tests cover session required, cross-session isolation for study/series/DICOM/image, reset deletion, expiry cleanup, upload caps, ZIP failures and read-only example. Run `python -m pytest -q` from `knee-web`.

## Trước khi public URL

Anonymous không có nghĩa là endpoint vô hạn hoặc dữ liệu công khai. Trước khi mở Internet cần:

1. Chỉ dùng MRI đã de-identify; không upload PHI/clinical studies vào demo.
2. HTTPS, rate limit theo IP/session ở ingress, giới hạn đồng thời/request timeout và quota để chống lạm dụng/chi phí.
3. Upload và metadata trên Cloud Run không được dựa vào local SQLite/filesystem: filesystem Cloud Run không bền khi instance dừng và local writes tiêu thụ memory. Dùng Cloud Storage tạm cho DICOM và metadata/session store dùng chung giữa instances.
4. API xóa object ngay khi reset/expiry; thêm Cloud Storage lifecycle làm cleanup dự phòng (lifecycle không phải đồng hồ xóa chính xác tới từng phút).
5. Kiểm thử race, nhiều instance, expired cookies, reset, object cleanup, backup/retention và logging không chứa thông tin bệnh nhân.

Hiện VM staging private qua IAP dùng một instance + SQLite/local disk, phù hợp để thử flow và caps. Chưa deploy public production. Tham khảo [GCP runbook](09-gcp-runbook.md) và [CI/CD](15-ci-cd-plan.md).
