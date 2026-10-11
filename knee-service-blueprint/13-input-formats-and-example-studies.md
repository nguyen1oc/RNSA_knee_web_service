# 13 — Input DICOM và lưu một example study

> **Cập nhật gần nhất:** 2026-10-10
> **Thay đổi gần nhất:** Provision cùng example public vào cả staging và production; mỗi môi trường dùng bucket/Firestore riêng, không tự seed khi deploy.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Áp dụng cho giai đoạn local ngày 05/10/2026. “Study” DICOM là nhóm theo StudyInstanceUID; một thư mục chỉ là cách chọn nhiều file, không tự quyết định số study. ZIP không mã hóa được mở ở staging và các member `.dcm` được group theo UID.

## 1. Supported matrix giai đoạn đầu

| Input | Cách nhập | Tổ chức sau import | Viewer |
|---|---|---|---|
| DICOM `.dcm` | Chọn nhiều file/thư mục | Group StudyInstanceUID → SeriesInstanceUID → SOP/frame | DICOM stack + display preview, hướng/spacing nếu metadata đủ |
| ZIP có nhiều study DICOM | Chọn `.zip` | Index các member `.dcm`, tách theo StudyInstanceUID, không trộn study | Đã nhận trong local vertical slice |
| Thư mục có file không phải DICOM | Cùng upload | DICOM hợp lệ được index; file khác báo unsupported | Không cố decode file lạ |
| TIFF/NIfTI/PNG/JPG/NPY/PDF/video/ZIP lồng/encrypted ZIP | Chưa hỗ trợ | Có code/lý do unsupported | Không cố decode |

DICOM baseline: single-frame grayscale, Explicit/Implicit VR Little Endian. Codec JPEG/JPEG-LS/JPEG2000/RLE và enhanced multi-frame chỉ enable khi đã test cả index và renderer; biết đọc header chưa chứng minh decode được pixel. UI nhận `.dcm`, thư mục và `.zip`; backend vẫn validate header/pixel thực.

Validation dựa trên parser/header thực, không chỉ extension hoặc MIME browser. Không dùng `force=True` để coi file tùy ý là DICOM. Kiểm tra format, rows/columns, pixel payload hợp lệ và UID bắt buộc; thiếu geometry vẫn có thể stack fallback có nhãn. File lỗi được liệt kê trong import result.

## 2. Folder mapping và hướng mở rộng ZIP

Một nút **Import study** mở menu có hai lựa chọn: **Files / ZIP** mở file picker nhận nhiều `.dcm` hoặc ZIP; **Folder** mở directory picker. Browser dùng native picker mode khác nhau cho file và folder, vì vậy menu cho người dùng chọn thao tác nhưng vẫn giữ một nút import duy nhất. Browser folder picker gửi `File` và relative path; không cấp cho backend quyền đọc filesystem client. Server sinh tên storage riêng. ZIP members được stream từ archive sang staging disk theo chunks; chỉ lấy member `.dcm`, bỏ qua thư mục, không giải nén nested/encrypted archive và không dùng member path để ghi trực tiếp.

Thông báo ingest thành công hiển thị dạng toast cố định ở góc dưới-phải và tự đóng sau 3 giây; lỗi giữ lại đến khi người dùng chủ động dismiss.

DICOM: tên folder không đáng tin để suy study/hướng. Hai folder có cùng StudyInstanceUID vẫn là một study; hai study trong cùng folder vẫn tách.

Thư mục chỉ là cách chọn nhiều file; tên folder không đáng tin để suy study/hướng. Hai folder có cùng StudyInstanceUID vẫn là một study; hai study trong cùng folder vẫn tách. File chọn rời được index theo UID như bình thường.

Sort dùng geometry nếu đủ IOP/IPP/PixelSpacing; fallback InstanceNumber rồi filename chỉ khi thiếu geometry và phải hiện warning. Lưu order vào manifest; không nhận JSON manifest tùy ý để chạy code hoặc truy cập đường dẫn server.

Giới hạn runtime mặc định: 600 MiB compressed/request, 800 MiB expanded/request, 800 MiB tổng/session, 200 MiB/DICOM và tối đa 500 DICOM/session request. Có thể cấu hình qua `.env`; đây là caps chống request quá lớn, không phải performance/SLA guarantee. `results.zip` hiện tại ~431 MiB nén, ~587 MiB expanded, 286 DICOM (2026-10-09), nằm trong defaults. Xem [18](18-anonymous-session-and-upload-limits.md).

## 3. Dữ liệu thực có trong workspace

Kiểm tra header bằng pydicom ngày 05/10/2026, không decode/duyệt pixel trong lượt kiểm kê này:

| Đường dẫn | Files | Series | Study |
|---|---:|---:|---|
| `dicom-viewer/files/series_1` + `series_2` | 34 + 30 | 2 | Cùng study |
| `dicom-viewer/files/results.zip` | 284 | Theo metadata trong archive | Một example study mới; seed tự flatten tên path |
| **Tổng fixture mẫu đang dùng** | **284** | **1 archive** | **1 StudyInstanceUID** |

Tất cả header kiểm tra là Explicit VR Little Endian, single-frame. Đây là **một sample study**, chưa kết luận de-identification, geometry/đủ ba hướng hoặc chất lượng hiển thị chỉ từ lần kiểm kê. Folder fixture hoặc `results.zip` đều được seed vào cùng `study_id`; không tách thành nhiều study nếu metadata chỉ có một StudyInstanceUID.

## 4. Lưu source sample và runtime như thế nào?

**Trạng thái triển khai (2026-10-10):** `dicom-viewer/files/results.zip` vẫn là source fixture local; local Docker mount thư mục này thành `/examples` và seed vào SQLite + volume `knee_data`. Script one-time `backend/provision_example.py` đã provision study `sample-knee` ở cả hai môi trường: staging có **284 DICOM objects / 5 series** tại `gs://rsna-knee-dicom-preview-511004/examples/sample-knee/` và Firestore `(default)`; production có **284 DICOM objects / 5 series** tại `gs://rsna-knee-dicom-production-511004/examples/sample-knee/` và Firestore `knee-review-production`. Cả hai dùng `source=sample`, không gắn session owner. Archive là public RSNA challenge data. Cloud Run không đọc archive từ máy/repo, không COPY DICOM/ZIP vào image, và `seed_sample()` vẫn skip cloud mode; vì vậy deployment/revision mới không tự seed. GCS prefix `examples/` tách khỏi upload `incoming/`; cleanup session không xóa example, endpoint delete từ chối sample. Production API đã được kiểm tra bằng temporary session: `/api/studies` trả `sample-knee`; session kiểm tra đã được xóa sau đó.

Provision/reconcile lại khi cần, từ thư mục `knee-web`, bằng ADC có quyền ghi Firestore và Storage:

```powershell
gcloud auth application-default login
python -m backend.provision_example --project rsna-knee-511004 --database "(default)" --bucket rsna-knee-dicom-preview-511004
# Production: dùng archive giống nhau, nhưng chỉ định đúng database và bucket production.
python -m backend.provision_example --project rsna-knee-511004 --database knee-review-production --bucket rsna-knee-dicom-production-511004
```

Script dùng Firestore ID và GCS object names xác định theo DICOM UID, archive SHA-256 để nhận ra cùng nguồn, chạy lại cùng ZIP là no-op khi metadata/objects đã đầy đủ, tự ghi tiếp nếu lần trước bị ngắt giữa chừng, và từ chối ghi đè nếu `sample-knee` đã tồn tại với nguồn khác. Nó chỉ dọn stale objects bên trong prefix riêng của example. Không đổi/xóa prefix đó bằng tay khi chưa kiểm tra metadata.

Source mẫu giữ ngoài image/code và ngoài thư mục đồng bộ nếu có thể. Ví dụ path host **dự kiến**, cần tạo/điền khi build:

```text
C:/knee-review/examples/
  examples.json
  demo-knee-study/
    source/
  series_1/               # folder fixture nếu dùng bản cũ
  series_2/               # folder fixture nếu dùng bản cũ
  results.zip             # fixture archive ưu tiên nếu tồn tại

Docker mount:
  C:/knee-review/examples → /examples (read-only, seed service)
  named volume knee_data → /data (api, worker, seed)

/data/
  app.db                     # metadata, import jobs, catalog
  uploads/<upload_id>/        # staging; xóa sau commit hoặc expired
  studies/<study_id>/originals/<asset_id>.<ext>
  thumbnails/<asset_id>.png   # cache có thể tạo lại
```

Giữ nguyên DICOM gốc trong source; dùng ZIP khi chia sẻ study như một file, nhưng runtime nên lưu từng asset đã index để lấy slice nhanh. Không giải nén lại ZIP mỗi lần người dùng mở viewer. DB lưu path/key, checksum, metadata; không lưu pixel blob.

Repo chỉ cần manifest template, thông tin nguồn và checksum; không cần commit MRI/checkpoint vào Git hay COPY vào Docker image. Source examples read-only là bản gốc để seed lại, **không là backup cho các study người dùng upload**. Backup runtime cần cả SQLite nhất quán và raw files; file DB đang WAL không copy riêng tùy tiện.

## 5. Seed contract

Manifest cho seed admin đọc ở `/examples/examples.json`, không phải một public upload format. [Template](templates/examples-manifest.template.json) còn null thì chưa đủ điều kiện seed READY.

Mỗi item có `example_id`, `version`, `label`, `source_kind`, `source_path`, `source_sha256`, provenance, trạng thái khử định danh và expected study/series/image counts. `source_path` phải nằm dưới `/examples`; không nhận host absolute path từ browser.

- ZIP checksum: SHA-256 bytes của ZIP. Folder checksum: SHA-256 của manifest chuẩn hóa UTF-8 gồm các dòng `relative_path + TAB + file_sha256 + LF`, sort path và dùng `/`; không đưa examples.json vào source hash.
- Seed key unique `(example_id, version)`. Cùng version + checksum + catalog còn nguyên → no-op. Cùng version khác checksum → lỗi cần tăng version; không overwrite im lặng.
- Copy folder source hoặc đọc archive → staging riêng → gọi cùng importer như upload. Archive mẫu được flatten thành tên ngắn trong `/data/studies/sample-archive`, nên Windows path dài bên trong ZIP không ảnh hưởng. Sample bắt buộc có đúng một StudyInstanceUID; số SeriesInstanceUID lấy theo metadata thực tế.
- Chỉ gắn card READY sau commit đầy đủ. File thiếu/index lỗi → hiện rõ; seed failure không phá catalog khác.
- Example read-only trên UI: không xóa mẫu bằng nút xóa study upload. Source version mới phải reseed có chủ ý, không tự đổi kết quả đang xem.
- Restart Compose không xóa uploads/catalog; chạy seed lại không sinh thêm study. Nếu DB mất nhưng raw còn, đây là restore/rebuild có kiểm tra, không cứ kết luận seed thành công.

## 6. Vòng đời dữ liệu

Study upload thuộc temporary browser session; không cần tài khoản. Người dùng có thể xóa một study hoặc bấm Clear session để xóa toàn bộ upload ngay; nếu không, session hết hạn sau 60 phút idle hoặc tối đa 4 giờ. Session expired bị từ chối; file vật lý được dọn lúc app startup/request tiếp theo. Example dùng chung, read-only. Limits/behavior cụ thể ở [18](18-anonymous-session-and-upload-limits.md).

Trước demo sample: mở được ảnh thật ở cả `series_1` và `series_2`, xác minh count/order, reboot container, chạy seed lần hai và kiểm tra số study không tăng. Xóa study upload phải không làm mất sample; nút xóa sample trả lỗi read-only.
