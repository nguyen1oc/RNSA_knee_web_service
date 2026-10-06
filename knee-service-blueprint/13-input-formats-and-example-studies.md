# 13 — Input DICOM và lưu một example study

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Bật upload `.zip` không mã hóa chứa DICOM; vẫn từ chối nested/encrypted archive.
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

Browser folder picker gửi `File` và relative path; không cấp cho backend quyền đọc filesystem client. Frontend dùng directory picker được browser hỗ trợ và có fallback chọn nhiều file `.dcm`. Server sinh tên storage riêng. ZIP được đọc qua `ZipFile` trong memory/staging, chỉ lấy member `.dcm`, bỏ qua thư mục, không giải nén nested/encrypted archive và không dùng member path để ghi trực tiếp.

DICOM: tên folder không đáng tin để suy study/hướng. Hai folder có cùng StudyInstanceUID vẫn là một study; hai study trong cùng folder vẫn tách.

Thư mục chỉ là cách chọn nhiều file; tên folder không đáng tin để suy study/hướng. Hai folder có cùng StudyInstanceUID vẫn là một study; hai study trong cùng folder vẫn tách. File chọn rời được index theo UID như bình thường.

Sort dùng geometry nếu đủ IOP/IPP/PixelSpacing; fallback InstanceNumber rồi filename chỉ khi thiếu geometry và phải hiện warning. Lưu order vào manifest; không nhận JSON manifest tùy ý để chạy code hoặc truy cập đường dẫn server.

Giới hạn mặc định để benchmark: tổng upload 500 MiB, tối đa 2.000 file DICOM. Worker kiểm tra bytes/file count, pixel estimate, timeout và disk free; ZIP cũng phải chịu cùng quota sau khi đọc member. Để 1 job import active; queue bounded và có 429 khi đầy. Các con số là giới hạn cấu hình ban đầu, không là bảo đảm máy nào cũng xử lý cùng tốc độ.

## 3. Dữ liệu thực có trong workspace

Kiểm tra header bằng pydicom ngày 05/10/2026, không decode/duyệt pixel trong lượt kiểm kê này:

| Đường dẫn | Files | Series | Study |
|---|---:|---:|---|
| `dicom-viewer/files/series_1` + `series_2` | 34 + 30 | 2 | Cùng study |
| `dicom-viewer/files/results.zip` | 284 | Theo metadata trong archive | Một example study mới; seed tự flatten tên path |
| **Tổng fixture mẫu đang dùng** | **284** | **1 archive** | **1 StudyInstanceUID** |

Tất cả header kiểm tra là Explicit VR Little Endian, single-frame. Đây là **một sample study**, chưa kết luận de-identification, geometry/đủ ba hướng hoặc chất lượng hiển thị chỉ từ lần kiểm kê. Folder fixture hoặc `results.zip` đều được seed vào cùng `study_id`; không tách thành nhiều study nếu metadata chỉ có một StudyInstanceUID.

## 4. Lưu source sample và runtime như thế nào?

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

Study import thành công được giữ đến khi người dùng xóa; bỏ TTL study 7 ngày của plan cloud cũ. Staging lỗi/incomplete hết hạn sau 24 giờ, bỏ qua job active. Thumbnail có thể tạo lại. Xóa study user upload cần dọn tham chiếu và raw files tương ứng, không đụng source sample. Read-only example là quy tắc nội dung, không phải auth hay account.

Trước demo sample: mở được ảnh thật ở cả `series_1` và `series_2`, xác minh count/order, reboot container, chạy seed lần hai và kiểm tra số study không tăng. Xóa study upload phải không làm mất sample; nút xóa sample trả lỗi read-only.
