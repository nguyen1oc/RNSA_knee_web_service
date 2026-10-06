# 12 — Build local từng bước: upload, viewer, 1 example study, Docker

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Chuẩn hóa metadata tài liệu; bổ sung liên kết quy ước commit/CI/CD.  
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Ngày chốt phạm vi: **05/10/2026**. Kế hoạch này đã có vertical slice đầu tiên tại `../knee-web`: FastAPI + SQLite + React build tĩnh, Docker Compose, sample study và upload/view DICOM. Các bước MPR/3D thật, ZIP, worker indexing và AI/cloud vẫn là phần tiếp theo. Tài liệu này cùng file 13 thay thế lịch AI/cloud ở file 07 và phiên bản file 11 ngày 30/09.

## 1. Kết quả cần có

Mở `http://localhost:8080` → thấy một sample study gồm hai series và danh sách đã nhập → mở sample hoặc nhập file/thư mục `.dcm` → ingest pipeline validate/group/sort → xem ảnh trong tabs + 4 ô, panel thông tin, expand cây Study → Series → slice files, chọn series, lướt lát, zoom/pan/contrast → bấm Analyze để nhận thông báo placeholder → refresh/restart vẫn mở lại được.

- React + TypeScript + Tailwind; Cornerstone cho DICOM `.dcm`.
- FastAPI, SQLite, một worker index; chạy bằng Docker Compose trên máy local.
- Không tài khoản, mật khẩu, IAP, JWT, dev identity hoặc owner/group. Một catalog chung của bản cài local.
- Chưa build model/checkpoint, preprocessing AI, Triton, AI panel hoặc GCP. Analyze chỉ là CTA placeholder, không gọi backend inference.
- Input trong giai đoạn này chỉ là DICOM `.dcm`; TIFF, NIfTI, PNG/JPG, NPY, video và PDF chưa thuộc supported matrix.

## 2. Những thiếu sót của plan trước và cách sửa

| Thiếu/lệch phạm vi | Điều chỉnh hiện hành |
|---|---|
| IAP/dev identity vẫn nằm trên luồng vào trang | Bỏ toàn bộ auth khỏi giai đoạn local; vào thẳng danh sách |
| Checkpoint/GPU/parity là gate D1 | Gate D1 là input formats, fixture và một đường render thật |
| “2 example” chưa có storage/seed contract | Một seed study gồm `series_1`/`series_2`, versioned, idempotent, có checksum; raw sample mount read-only |
| Hai thư mục series dễ bị hiểu thành hai study | Đã xác nhận 64 DICOM hiện có thuộc 1 StudyInstanceUID; đây là một sample study |
| SQLite đặt cạnh code trong OneDrive dễ bị đồng bộ khi đang ghi | Runtime SQLite + raw data nằm trong Docker named volume |
| Upload retry/restart và import trùng chưa rõ | Receipt theo file, complete idempotent; worker persist trạng thái; không overwrite cùng UID khác nội dung |
| Đòi ba hướng/3D cho mọi input | Chỉ hiện các hướng thực có; thiếu geometry thì báo rõ và chưa dựng MPR |
| Demo có score giả và panel AI | Chỉ giữ Analyze CTA có notice; không tạo score/result giả |

## 3. Thứ tự build và điều kiện xong từng bước

| Step | Việc xây | Owner | Kết quả phải thấy trước khi đi tiếp |
|---|---|---|---|
| **1 — Chốt dữ liệu** | Kiểm kê một sample study; định nghĩa DICOM `.dcm`; freeze manifest/API v0.2 | Cả hai | `series_1`/`series_2` có metadata, số ảnh và expected order |
| **2 — Skeleton Docker** | Tạo `knee-web/` với frontend, backend, worker, compose; SQLite migration; web proxy `/api/v1` | Người 1; Người 2 dựng shell | Một URL localhost mở app; `/health/ready` báo DB/storage được; chưa cần GPU |
| **3 — Import DICOM** | Upload file/thư mục, receipt, index UID, manifest, file endpoint; dựng một stack bằng Cornerstone | Người 1 API; Người 2 viewer | Tự upload ca DICOM hiện có → 1 study, 2 series, 34 và 30 ảnh; lướt ảnh đúng thứ tự |
| **4 — Danh sách + sample** | Study list, import dialog/progress, seed một source gồm `series_1`/`series_2` cùng pipeline | Người 1 seed; Người 2 UI | Bấm Mở mẫu không upload lại; seed chạy lần 2 không sinh thêm study |
| **5 — Workspace tree** | Sidebar Study → Series → slice files, 4 ô hoặc một stack, hướng, zoom/pan/display preview/reset, Analyze placeholder | Người 2; Người 1 metadata | Series chọn độc lập; thiếu hướng báo rõ |
| **6 — Xóa + bền vững** | Confirmation, sample read-only, cleanup files/DB, refresh, restart, duplicate import | Người 1 storage; Người 2 states | Study upload xóa được; sample không xóa; restart không mất dữ liệu |
| **7 — Lỗi + limits** | Unsupported DICOM, disk/memory, partial/failed | Cả hai | Lỗi có hành động rõ, không orphan/delete nhầm |
| **8 — ZIP (deferred)** | Chỉ làm khi scope mở lại: giải nén giới hạn, nhận diện DICOM, report lỗi | Cả hai khi được bật lại | Không block local vertical slice hiện tại |
| **9 — Nghiệm thu Docker** | Build mới, seed, upload folder/file `.dcm`, đổi study 10 lần; backup/restore; README chạy local | Cả hai | Người còn lại chạy theo README và mở được sample + study upload |

Step 3 là mốc đầu tiên: **upload thật → một stack thật**. Không cần chờ dựng xong mọi màn hình. Sau đó seed, tree/display controls và delete có thể làm song song khi contract ổn định; ZIP để sau khi P0 hiện tại ổn định.

MPR/crosshair/khung 3D là P1 sau step 9; không là điều kiện nghiệm thu local. Ô trên trái của overview hiện 3D locator/khung định hướng, không hiển thị khối giả như dữ liệu bệnh nhân và chưa mapping click → patient slice.

## 4. Cấu trúc app dự kiến và trạng thái hiện tại

Cây dưới là cấu trúc đích. Hiện vertical slice đã được tạo trong `knee-web/`; worker, ZIP importer và MPR vẫn chưa có:

```text
knee-web/
  frontend/src/main.jsx    # page orchestrator: API, study/session and viewer state
  frontend/src/components/ # small reusable viewer/sidebar/toolbar components
  frontend/src/styles.css  # shared layout and design tokens
  backend/main.py            # FastAPI upload, catalog, DICOM metadata and PNG routes
  backend/requirements.txt
  compose.yaml               # localhost:8080 + named data volume + read-only examples
  Dockerfile                # Python runtime; consumes frontend/dist
  README.md
  data/                      # runtime-only when running without Docker
```

The current frontend keeps `main.jsx` focused on orchestration. `ImageCard`, `OverviewGrid`,
`StudySidebar`, `SeriesBrowser`, `ViewerTabs`, `ViewerToolbar`, `DisplayToolbar`, `LocatorCard`,
`StudyInfoPanel` and `EmptyWorkspace` are separate components so viewport behavior and layout
can be reviewed without growing one large page file.

Current implemented vertical slice:

- sample `series_1` + `series_2` is seeded as one read-only study;
- `.dcm` files/folders run through validate → metadata → geometry validation (IOP/IPP/PixelSpacing/FrameOfReferenceUID) → group → geometry-aware sort, then persist into SQLite + local storage;
- Study → Series → slice tree, Overview + focused SAG/COR/AX tabs, wheel/pinch zoom, pointer-drag pan, display preview and delete uploaded study;
- a newly opened series starts on its middle representative slice so the first viewport is not an edge slice;
- tabs, 4-slot viewer and Study information panel mirror `templates/design-board.html`;
- Analyze CTA is visible and returns an explicit “AI/Triton not connected” notice;
- no auth, AI, Triton, GPU or GCP;
- 3D card is an orientation locator placeholder, not patient-specific 3D.

`dicom-viewer/` hiện là viewer browser-only, không có API upload/persistence. Có thể đối chiếu hành vi và tái sử dụng logic sau review; không coi `npm start` của repo đó là service Docker mới.

## 5. Các container cần có

| Service | Nội dung | Mount | Port ra host |
|---|---|---|---|
| `web` | React build + Nginx; serve SPA và proxy API | Frontend trong image | `127.0.0.1:8080:80` |
| `api` | FastAPI, migration trước readiness | `knee_data:/data` | Không publish |
| `worker` | Nhận job index từ SQLite, 1 job/lần | `knee_data:/data` | Không publish |
| `seed` | Chạy một lần mỗi lần Compose khởi động/recreate; đăng ký sample import idempotent | `${EXAMPLES_DIR}:/examples:ro` và `knee_data:/data` | Không publish |

API hoàn tất migration rồi seed/worker mới bắt đầu. Seed copy source mẫu vào staging trong `/data`, tạo job và thoát; worker index như upload bình thường. UI poll tới READY/PARTIAL. Thiếu sample không làm sập API: sample hiện “Chưa có dữ liệu mẫu”; sample chỉ tính xong khi cả `series_1` và `series_2` mở được.

Raw file sau import và DB đều ở named volume; phục vụ qua API, không đặt DICOM trong `frontend/public`. Volume sống độc lập với container. [Docker volumes](https://docs.docker.com/engine/storage/volumes/).

Publish localhost làm app chỉ phục vụ trên máy chạy Docker trong cấu hình local; không bật tunnel/public deployment ở bước này. [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/).

Lệnh **dự kiến sau khi đã tạo app/compose**, chạy trong `knee-web/`:

```powershell
docker compose up --build -d
docker compose ps -a
docker compose logs --tail=100 api worker seed
docker compose down
```

`down` thông thường giữ named volume. `down -v` xóa volume và dữ liệu đã nhập; không dùng làm thao tác restart. Bootstrap cần Docker Desktop chạy Linux containers, thư mục samples mount được, và disk đủ cho staging + bản import. Local viewer không cần CUDA hay NVIDIA GPU server.

## 6. Triton nào, checkpoint đặt đâu, GPU từ đâu?

| Tên | Vai trò | Liên quan dự án |
|---|---|---|
| **NVIDIA Triton Inference Server** | Server chạy model, nhận HTTP/gRPC, quản lý load/version/readiness, scheduling và batching khi model hỗ trợ | Dùng ở giai đoạn AI sau |
| **Triton language/compiler** (`triton-lang`) | Viết và biên dịch GPU kernels, tối ưu phép tính | Không cần viết kernel để dùng Inference Server |

Hai dự án khác nhau dù trùng tên. Nguồn: [NVIDIA server](https://github.com/triton-inference-server/server), [Triton language](https://triton-lang.org/main/index.html).

Checkpoint sẽ được đóng gói trong **model repository** mà Triton đọc. File `.pth` chứa `state_dict` chưa đủ để server tự biết architecture/preprocessing: cần code kiến trúc, load weights và input/output contract, hoặc export sang format backend hỗ trợ. Với Python backend, `model.py` load model khi initialize và thực hiện inference trong execute. [Model repository](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_repository.html), [Python backend](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/python_backend/README.html).

```text
Giai đoạn local hiện tại:
Browser → web/FastAPI → SQLite + file storage → ảnh về browser

Giai đoạn AI tương lai:
Browser → FastAPI/worker → preprocessing → Triton trên GPU VM GCP → score
                                              ↑
                                   model repository + checkpoint
```

GPU inference là GPU gắn với VM GCP chạy Triton và được cấp cho container. GCS có thể lưu checkpoint nhưng không cung cấp compute GPU. Triton local không tự dùng GPU GCP: muốn dùng GPU ở đó phải chạy server ở đó và gọi endpoint qua kết nối đã thiết kế. Browser vẫn dùng tài nguyên máy người dùng để render ảnh. Bật model/GCP là sprint sau, không cần dựng skeleton inference trong sprint local.

## 7. Metrics và tiêu chí bàn giao

Chạy bộ đo ở [14 — Metrics local](14-local-metrics-and-acceptance.md). Tối thiểu phải có bằng chứng cho grouping/order, upload/index, mở ảnh đầu, cached slice, memory, delete, restart/recovery, seed idempotency và backup/restore.

- Docker chạy từ README, không cần cài Python/Node trực tiếp để vận hành app đã build.
- Một sample study thật gồm `series_1`/`series_2` được seed và mở được; không đếm card placeholder.
- Upload folder DICOM, nhiều file `.dcm` và ZIP đều có kết quả kiểm chứng.
- Study upload có thể xóa sau confirmation; sample trả lỗi read-only; cleanup không xóa nhầm dữ liệu.
- Catalog/ảnh không mất sau refresh hoặc recreate container; seed không nhân bản.
- Không login, password, token, AI score hay phụ thuộc GCP trong luồng local.
- Supported formats và các hướng không có được hiển thị rõ; bước kiểm thử xem [08](08-qa-release.md).
