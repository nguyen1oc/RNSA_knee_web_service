# 04 — Kiến trúc local và lưu trữ

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Bổ sung anonymous session ownership, TTL cleanup và bounded upload staging.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Phạm vi local hiện hành: không có tài khoản/đăng nhập, không inference, không cloud. Docker Compose cấp temporary HttpOnly session cookie; study upload thuộc một session, không phải catalog chung. Đây là session isolation, không thay thế đầy đủ account authentication/abuse controls cho public production.

```mermaid
flowchart LR
    Browser[React và viewer trên browser] -->|localhost:8080| Web[Nginx: SPA và API proxy]
    Web --> API[FastAPI]
    API --> Sessions[(Anonymous session hashes)]
    API --> DB[(SQLite)]
    API --> Files[(Raw files)]
    Worker[Index worker] --> DB
    Worker --> Files
    Examples[Examples trên host, read-only] --> Seed[Seed một lần]
    Seed --> DB
    Seed --> Files
```

SQLite và raw files cùng nằm trong named volume `knee_data:/data`. Seed copy mẫu vào staging và tạo import job; worker xử lý như upload. Chỉ web publish `127.0.0.1:8080:80`, các service còn lại dùng Compose network. Browser render bằng tài nguyên local; server không cần NVIDIA GPU.

## Trách nhiệm

| Thành phần | Trách nhiệm |
|---|---|
| Web/React | List/examples, upload, sidebar, render, presentation state |
| FastAPI | Streaming receipt, validation nhẹ, catalog/manifest/files, enqueue index |
| Index worker | ZIP extraction, kiểm tra/nhóm DICOM, metadata/sort, thumbnail và commit |
| Seed | Validate source/checksum/version, copy vào staging, đăng ký job idempotent |
| Storage | Source originals immutable, DB bền vững, cache tạo lại được |

API không decode toàn study trong event loop. Worker dùng cùng Python image/codebase với API nhưng entrypoint riêng; chưa cần Redis/Celery. API chạy migration trước readiness; seed/worker chờ DB sẵn sàng. SQLite WAL, busy timeout, transaction ngắn.

## Schema tối thiểu

| Entity | Trường chính |
|---|---|
| uploads | id, kind, state, created_at, expires_at, accepted_bytes, receipts |
| import_jobs | id, upload_id, state, stage, lease_until, attempt, error |
| studies | id, source_kind=dicom, dicom_study_uid, label, source=upload/example, owner_session_id (upload only), state, inventory_version |
| series | id, study_id, dicom_series_uid nullable, plane/fs/fluid nullable, label_source, geometry_status, sort_method |
| assets | id, series_id, dicom_sop_uid, relative_source_path, object_key, checksum, transfer_syntax, rows/columns, frame_count |
| example_versions | example_id, version, source_checksum, state, import_job_id, study_id nullable |
| anonymous_sessions | token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at |

Upload study rows carry `owner_session_id`; shared example rows have no session owner and are read-only. Server stores only a SHA-256 digest of the random cookie token. App IDs are UUID. Original path does not use client filenames; API looks up by asset ID. DICOM SOP/frame retain provenance.

## Duplicate và commit

DICOM import lại cùng UID và checksum → reuse, báo duplicate; không tạo study mới. Cùng SOP UID khác checksum → conflict, không overwrite. Thêm asset mới vào study đã có tăng inventory_version; reader thấy snapshot inventory đã commit. Study example read-only: import khớp trả existing; bổ sung/thay đổi dưới cùng UID vào example báo conflict, không sửa mẫu qua upload.

Mỗi file phải được validate bằng header/pixel parser; extension `.dcm` chỉ là bộ lọc đầu vào, không phải bằng chứng file hợp lệ.

Commit staging → final paths bằng atomic rename cùng volume, sau đó transaction công bố inventory READY/PARTIAL. Khi crash trước DB commit, worker retry nhận diện/checksum file đã chuyển; không delete raw committed ở job khác. Dọn orphan chỉ sau khi đối chiếu DB/job và grace period, không xóa toàn staging/raw khi boot.

## Trạng thái và recovery

Upload: OPEN → CLOSED (complete được nhận) hoặc EXPIRED. Job: QUEUED → RUNNING → SUCCEEDED/PARTIAL/FAILED. Stage VALIDATING/EXTRACTING/INDEXING/COMMITTING; không dùng phần trăm giả.

Worker claim transaction, heartbeat/lease, retry transient tối đa một lần khi lease hết hạn. Validation/unsupported không tự retry. API restart không mất queue; worker restart không để RUNNING mãi. UI poll theo upload/job ID.

## Storage lifecycle và restore

Examples host mount chỉ đọc; DB/raw runtime trong Docker volume tránh SQLite chạy trên folder OneDrive. Study upload xóa được ngay hoặc hết hạn sau 60 phút idle/4 giờ absolute. Cleanup chạy khi app start và ở request kế tiếp; vì vậy physical deletion có thể đợi request/startup sau nếu app không hoạt động, nhưng expired session không đọc được nữa. Upload/archive được stream qua disk staging với limits xem [18](18-anonymous-session-and-upload-limits.md). Example read-only. Xóa session xóa rows và raw files cùng scope; không xóa source sample.

Backup local: dừng nhận import, chờ worker idle và dừng writer; snapshot nhất quán DB + raw files, hoặc SQLite backup API phối hợp inventory frozen. Thử restore vào volume riêng, kiểm tra count/checksum/mở ảnh. `docker compose down` giữ volume; `down -v` xóa volume. Chi tiết cấu trúc [13](13-input-formats-and-example-studies.md).

## Sau này nối AI

Thêm model repository, preprocessing và Triton client khi bắt đầu phase AI; không cần xây endpoints/model tables/panel trước. Giữ originals + metadata + inventory_version hiện tại để hỗ trợ snapshot đầu vào về sau.
