# 18 — Anonymous temporary workspace

> **Cập nhật gần nhất:** 2026-10-10
> **Thay đổi gần nhất:** Ghi nhận cloud folder upload được đóng gói thành ZIP trong browser; làm rõ CORS Preview và upload limits.
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

Ở cloud mode, khi người dùng chọn nhiều file `.dcm` hoặc một folder, frontend đóng gói các DICOM đó thành một ZIP không nén trước khi upload resumable trực tiếp lên GCS. Việc này tránh tạo hàng trăm upload-init API requests và giữ đường dẫn Series trong archive. Local Docker tiếp tục gửi multipart như trước. Với study có nhiều Series, chọn **folder Study ở cấp cao nhất** hoặc ZIP chứa mọi Series; chỉ chọn folder của một Series sẽ tạo study chỉ có Series đó. Giới hạn cloud là tối đa 500 DICOM, 200 MiB/DICOM, 600 MiB/archive và 800 MiB/session; nếu cần chia study lớn, chọn nhiều ZIP theo Series trong cùng một lần import để backend gom theo `StudyInstanceUID`.

## Kiểm thử local/staging

```powershell
cd knee-web
docker compose up --build
```

Acceptance: mở workspace không đăng nhập; session A upload và xem; session B (browser profile khác) không thấy study A; A xóa study hoặc bấm Clear session thì file mất; example vẫn còn; idle/max TTL trả 401 và cleanup; upload qua từng cap trả HTTP 413 có thông báo; `results.zip` mẫu dưới cap vẫn ingest được. Compose lưu SQLite/files trên named volume cho staging/local, không phải cloud persistence.

Automated API tests cover session required, cross-session isolation for study/series/DICOM/image, reset deletion, expiry cleanup, upload caps, ZIP failures and read-only example. Run `python -m pytest -q` from `knee-web`.

## Public preview: còn điều kiện trước khi bật upload

Anonymous không có nghĩa là endpoint vô hạn hoặc dữ liệu công khai. Trước khi mở Internet cần:

1. Frontend production `rnsa-knee-web-service.vercel.app` và Preview deployment dùng Vercel; Preview `/api/health` trả `ok`. API health không thay thế kiểm tra upload.
2. Public backend đang chạy trên Cloud Run với URL HTTPS do Google cấp; không dùng VM GPU làm web/API host. `SESSION_COOKIE_SECURE=true` và CORS/origin/session behavior phải được kiểm thử trên đúng domain Vercel. Với Preview, thêm chính xác origin Preview vào Cloud Run `CORS_ALLOWED_ORIGINS` và bucket CORS.
3. Không proxy ZIP/DICOM bytes qua Vercel Function (body tối đa 4.5 MiB) hoặc Vercel external rewrite (timeout 120 giây); Cloud Run HTTP/1 cũng giới hạn request 32 MiB. ZIP mẫu 431 MiB cần browser → Cloud Storage resumable upload; API cấp upload session, xác minh/finalize object rồi ingest theo job.
4. DICOM raw files phải ở Cloud Storage private bucket; session/study/job metadata phải dùng shared store (Firestore hoặc Cloud SQL), không SQLite/local filesystem của Cloud Run. API xóa object khi Clear/expiry; lifecycle policy là cleanup dự phòng.
5. Rate limit cần áp dụng theo client/IP ở edge/API và theo session cho tạo phiên/upload/finalize; thêm concurrency caps, storage quotas, upload timeouts, abuse monitoring và retention. Không mở upload public trước khi các giới hạn này được cấu hình.
6. Chỉ dùng MRI đã de-identify; không upload PHI/clinical studies vào demo. Test cross-session isolation, expired sessions, signed/resumable upload expiry, reset/object cleanup, multiple instances and logs without patient identifiers.

Hiện VM staging private qua IAP vẫn dùng Compose + SQLite/local files, chỉ phù hợp kiểm thử nội bộ; chưa phải public backend. Chi tiết target ở [GCP runbook](09-gcp-runbook.md), [public preview plan](19-public-preview-deployment.md) và [CI/CD](15-ci-cd-plan.md). Tham khảo [Vercel function limits](https://vercel.com/docs/functions/limitations), [Vercel external rewrites](https://vercel.com/docs/routing/rewrites), [Cloud Run quotas](https://docs.cloud.google.com/run/quotas) và [Cloud Storage resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads).
