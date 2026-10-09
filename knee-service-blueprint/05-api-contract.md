# 05 — API v0.2: local upload và viewer

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Ghi contract anonymous session cookie, isolation và upload limits.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Base implementation `/api`, JSON snake_case, thời gian UTC, ID UUID. Không có username/password/account/provider. Backend dùng opaque HttpOnly `knee_session` cookie để isolate uploaded data. Cookie không được trả cho JavaScript; session record chỉ lưu token hash. Local cookie Secure=false trên HTTP; deployment HTTPS phải cấu hình Secure. API/React cùng origin qua web proxy.

## Temporary session endpoints (implemented)

| Method + path | Behavior |
|---|---|
| POST `/api/sessions` | Create anonymous session and set HttpOnly cookie |
| GET `/api/sessions/current` | Return current session metadata; 401 if absent/expired |
| DELETE `/api/sessions/current` | Delete session-owned uploaded studies/files and expire cookie; shared example remains |

All study/series/instance/image/DICOM routes require the cookie for user-uploaded content. A different browser profile receives no access. Session defaults: 60-minute idle, 4-hour absolute. Request/expanded/session/file/count upload caps and HTTP 413 are specified in [18](18-anonymous-session-and-upload-limits.md).

## API P1 đang implement (base /api)

- GET /api/series/{id}/slices: thêm dicom_url; image_url giữ cho thumbnails.
- GET /api/instances/{id}/dicom: application/dicom nguyên bản, lookup bằng ID index; 404 khi ID/file không tồn tại. Dữ liệu chứa toàn bộ tags gốc nên chỉ dùng localhost với study đã khử định danh.
- GET /api/series/{id}/volume: eligible, reasons, dicom_urls (rỗng nếu không hợp lệ); khi đủ geometry có slice_count, slice_spacing_mm, pixel_spacing_mm, anisotropic. 404 nếu series không tồn tại.
- Không cần DICOMweb server cho phase này: Cornerstone wadouri loader tải file qua cùng origin. Đây không phải triển khai WADO-RS/QIDO-RS đầy đủ.

## Endpoints P0 đề xuất (historical; không phải contract implementation)


| Method + path | Kết quả |
|---|---|
| GET /health/ready | DB/storage/migration readiness; seed status có trường riêng |
| GET /examples | Một manifest entry với state, source_kind=dicom, study_id và lỗi nếu sample thiếu |
| POST /uploads | kind=files, label optional; 201 upload_id; accepts `.dcm` files/folders and `.zip` archives |
| POST /uploads/{id}/files | Multipart streaming + client_file_id/relative_path; 200 receipts/checksums |
| POST /uploads/{id}/complete | Freeze receipt set, enqueue index; 202 job_id |
| GET /uploads/{id} | Receipt summary, job state, study_ids và import report khi xong |
| GET /jobs/{id} | Import state/stage, warnings/errors, counts, retryable |
| POST /jobs/{id}/retry | Job mới từ staging còn nguyên; chỉ khi retryable, nếu expired phải upload lại |
| GET /studies?cursor=...&source=upload | Catalog đã nhập, pagination; omit source để lấy tất cả |
| GET /studies/{id} | Series list, source kind, warnings, inventory_version |
| GET /studies/{id}/pipeline | Validate, metadata, grouping, sort and preview stage status |
| GET /series/{id}/manifest | Ordered assets/frame references, geometry và capabilities |
| GET /series/{id}/geometry | Geometry validation result, orientation/normal, position range, slice spacing và mapping warnings |
| GET /assets/{id}/file | Bytes DICOM gốc; Content-Type `application/dicom` |
| GET /assets/{id}/thumbnail | Preview cho sidebar, không thay ảnh đầy đủ |
| DELETE /studies/{id} | 202 deletion job_id, chỉ study upload idle; sample trả 409 EXAMPLE_READ_ONLY |

Job endpoint dùng chung cho INDEX và DELETE; stage/type luôn explicit. Không có job AI trong v0.2.

DELETE cần confirmation ở UI trước khi gọi. Server kiểm tra study tồn tại, `source=upload`, không còn import/viewer job active; sau đó chuyển `DELETING`, ẩn khỏi danh sách và enqueue cleanup. Cleanup xóa asset files trước rồi xóa rows/manifest trong transaction phù hợp. Thành công trả `SUCCEEDED`; lỗi trả `DELETE_FAILED` với retry an toàn. Sample/example luôn read-only.

## Upload và idempotency

Frontend folder picker gửi relative paths; backend không nhận absolute host path. Mỗi receipt gắn (upload_id, client_file_id) unique. Retry cùng checksum trả receipt cũ; cùng key khác bytes trả 409. Server đếm bytes thực, ghi temp rồi rename; không tin size client.

Complete dùng Idempotency-Key scoped theo upload. Cùng key/cùng receipt-set → cùng job; đổi payload → 409. Một upload chỉ complete một lần; gọi lại với key mới vẫn trả job đã có nếu receipt-set không đổi. OPEN mới nhận file; CLOSED reject file mới.

Local vertical slice nhận `.dcm` files/folders và `.zip` không mã hóa; backend streams archive/files sang staging disk, chỉ mở member DICOM, bỏ qua thư mục và chặn path traversal/nested ZIP. Defaults: 600 MiB request, 800 MiB expanded/session, 200 MiB per DICOM, 500 DICOM files; vượt trả 413. Chi tiết [18](18-anonymous-session-and-upload-limits.md) và [13](13-input-formats-and-example-studies.md).

## Series manifest tối thiểu

```json
{
  "series_id": "series-example-id",
  "source_kind": "dicom",
  "plane": "SAG",
  "fat_suppression": null,
  "fluid_sensitive": null,
  "label_source": "unknown",
  "sort_method": "physical_position",
  "geometry_status": "valid",
  "geometry": {
    "status": "valid",
    "mapping_ready": false,
    "frame_of_reference_uid": "...",
    "image_orientation_patient": [1, 0, 0, 0, 1, 0],
    "normal": [0, 0, 1],
    "position_range": [0, 96],
    "slice_spacing": 3.0,
    "warnings": []
  },
  "capabilities": {
    "window_level": true,
    "physical_geometry": true,
    "mpr": false
  },
  "images": [
    {
      "asset_id": "asset-example-id",
      "frame_number": 1,
      "file_url": "/api/v1/assets/asset-example-id/file"
    }
  ],
  "warnings": []
}
```

IDs trên chỉ minh họa, dùng UUID ở implementation. images lưu thứ tự render; DICOM frame_number 1-based. Geometry được chuẩn hóa từ IOP/IPP/PixelSpacing/Rows/Columns và FrameOfReferenceUID. `geometry_status` có thể là `valid`, `partial`, `incompatible` hoặc `unknown`; `valid` không có nghĩa MPR đã triển khai. `mapping_ready` chỉ true khi study có đủ series hợp lệ và dùng chung FrameOfReferenceUID; capabilities.mpr vẫn false ở P0.

## Import report

Report trả studies created/reused, series/assets counts, duplicates, unsupported_files, invalid_files, conflicts và sort/geometry warnings. Một ZIP có nhiều StudyInstanceUID trả nhiều study IDs; UI cho chọn, không tự merge. Không có file DICOM xem được → FAILED; một phần xem được → PARTIAL; chỉ duplicate hợp lệ có thể SUCCEEDED với reused IDs.

## File serving và lỗi

Tra asset_id trong DB rồi resolve dưới /data; không nhận đường dẫn trực tiếp. MIME chỉ từ format đã validate, nosniff, không serve SVG/HTML tùy ý. GET file chỉ đọc, không mutate. Mutating requests kiểm tra Origin/Host cùng local app và không mở wildcard CORS; đây là kiểm tra request, không phải auth. Raw response có cache policy rõ, không bật shared proxy cache mặc định.

Error envelope:

```json
{"error":{"code":"UNSUPPORTED_FORMAT","message":"Định dạng chưa hỗ trợ","retryable":false,"request_id":"req-demo","details":{}}}
```

404 NOT_FOUND; 409 INSTANCE_CONFLICT/UPLOAD_CLOSED/EXAMPLE_READ_ONLY/STUDY_BUSY/DELETE_FAILED; 413 LIMIT_EXCEEDED; 422 INVALID_DICOM/UNSUPPORTED_FORMAT/UNSUPPORTED_TRANSFER_SYNTAX; 429 QUEUE_FULL; 503 STORAGE_UNAVAILABLE. Background import errors nằm trong job/report, không đổi HTTP upload receipt thành bằng chứng index thành công.

## Contract DoD

Người 1 xuất OpenAPI và response fixtures; Người 2 build client/mock theo đúng contract. Thử round-trip thật cho DICOM, ZIP và DELETE; pin decoder/tools tương thích. Không ghi endpoint đã chạy khi mới có docs.
