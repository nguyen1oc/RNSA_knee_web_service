# Changelog — Knee Review

> **Cập nhật gần nhất:** 2026-10-08
> **Thay đổi gần nhất:** Thêm folder picker dễ thấy, byte-level upload progress/transfer ETA và chuyển trạng thái upload khỏi banner workspace.
> **Quy ước:** Mỗi entry ghi ngày, commit hoặc nguồn, nhóm thay đổi và tác động. Các kế hoạch cũ không bị xóa; chúng được đánh dấu historical/deferred trong tài liệu liên quan.

## 2026-10-08 — Multi-user authentication and GPU roadmap

### Added / Changed

- Đề xuất Identity Platform email/password quản lý credential/sign-in/reset; FastAPI xác minh ID token và phân quyền theo UID.
- PostgreSQL/Cloud SQL chỉ giữ app profile/role, study `owner_uid`, metadata; không lưu password. Invite-only signup cho giai đoạn đầu.
- Thêm thứ tự rollout auth, cross-user authorization tests, ownership migration, GCS private storage và acceptance gate ở [18](18-auth-and-user-data-plan.md).
- Làm rõ staging hiện tại là một VM `e2-medium` CPU-only; Triton/GPU chưa được tạo. Định hướng benchmark sau này trên GPU VM riêng, kiểm tra quota/zone/giá trước.
- Cập nhật architecture, GCP runbook, GCP glossary, blueprint README và app README.

## 2026-10-08 — Private GCP staging plan

### Changed

- Chọn Compute Engine VM + Docker Compose cho lần deploy staging đầu để giữ nguyên SQLite, local files và seed example hiện tại.
- Đặt staging sau IAP/SSH tunnel, không public web endpoint; giới hạn dữ liệu ở sample đã de-identify.
- Làm rõ vai trò GCP, Terraform, Triton, GPU và Kubernetes/GKE; Cloud Run/PostgreSQL/Cloud Storage là hướng nâng cấp sau khi tách persistence.
- Cập nhật GCP runbook, architecture, CI/CD plan, blueprint README và app README.
- Thêm [17 — GCP basics and first deploy](17-gcp-basics-and-first-deploy.md) với khái niệm nền, credentials và bước kế tiếp.
- Ghi nhận theo xác nhận người dùng: `rsna-knee-511004` có billing và budget alert; chưa ghi amount/threshold vì chưa được cung cấp.
- Ghi nhận theo cập nhật người dùng: `knee-review-staging-01` đã tạo/chạy tại `asia-southeast1-a`, không external IPv4; tại thời điểm ghi nhận ban đầu, IAP tunnel và app deploy chưa được xác nhận.

## 2026-10-08 — IAP SSH and Cloud NAT progress

### Changed

- Ghi nhận theo xác nhận người dùng: network tag/firewall khớp và SSH qua IAP vào VM thành công.
- Ghi nhận Public Cloud NAT `knee-review-nat`, Cloud Router `knee-review-router`, VPC `default`, `asia-southeast1`, IPv4 ranges, Automatic NAT IP allocation, Standard tier.
- Giải thích Cloud NAT chỉ cấp outbound egress cho VM private và traffic phản hồi; không biến VM thành public endpoint hay thay IAP cho SSH.
- Bước tiếp theo là kiểm thử outbound thực tế từ VM; chỉ sau đó mới cài Docker/Compose và deploy. Chưa có xác nhận app đã deploy.

## 2026-10-08 — First staging deployment and database decision

### Changed

- Xác minh `apt-get update`, cài Docker Engine/Compose và chạy `hello-world` trên VM staging.
- Clone nhánh `dev` tại commit `8f8d805`; chuyển riêng `results.zip` vào thư mục example trên VM và xác minh SHA-256 trùng nguồn local.
- Build/start Docker Compose; API health trả `ok`, example seed có một study, 5 series và 284 slices; chỉ bind loopback VM `8080`.
- Thiết lập IAP port-forward local `8081` → VM `8080` để duyệt mà không public web port.
- Quyết định hoãn Cloud SQL: giữ SQLite trong named volume cho single-VM staging; cần migration PostgreSQL và chuyển file DICOM sang object storage khi mở rộng.

## 2026-10-07 — Overview order and design-board parity

- Đặt MRI Volume ở ô đầu/trên trái của `3D four-up` và chọn nó mặc định; các MPR theo thứ tự axial, sagittal, coronal.
- Đồng bộ thứ tự và thanh công cụ Overview trong `templates/design-board.html` với giao diện app hiện tại; cập nhật spec và acceptance.
- Bỏ các thanh Contrast/Brightness/Invert minh họa không có trong Overview; giữ Window / Level như tool tương tác đúng với app.

## 2026-10-07 — MRI volume zoom controls

### Changed

- Thêm nút zoom out / in và phần trăm ngay trong header của `3D · MRI volume`; thao tác qua nút tránh phụ thuộc vào right-drag khó nhận biết.
- Zoom out được dưới mức fit ban đầu đến sàn an toàn 1%; zoom in không đặt giới hạn hữu hạn. Reset Overview đưa camera volume về fit ban đầu.
- Đặt con trỏ mũi tên bốn chiều trên nền đen của viewport MRI Volume để báo vùng đó có thể kéo xoay; giữ thao tác riêng cho plane, gizmo và control.
- Study UID và Cross-series geometry wrap/căn trái trong panel; thông báo Analyze được đặt trong luồng content thay vì banner toàn trang.
- Giữ chuột phải-drag như thao tác phụ; wheel trên volume vẫn cuộn lát MPR đang chọn. Cập nhật viewer spec, acceptance, README và design board HTML.

## 2026-10-07 — MPR source selector and mini-orbit gizmo

### Changed

- Đổi selector trong Overview thành `MPR source`; một series nguồn duy nhất dựng volume và cả ba mặt phẳng axial/sagittal/coronal. Đổi nguồn sẽ tải lại đồng bộ bốn viewport; series gốc vẫn duyệt riêng trong direction tabs và Images / Series.
- Khi mở study, ưu tiên series có metadata hình học hợp lệ, sau đó ưu tiên sagittal và số lát nhiều hơn. Đây chỉ là lựa chọn ban đầu; geometry gate khi dựng volume mới xác nhận MPR có dùng được hay không.
- Thay các mũi tên bằng ba vòng orbit mảnh trên nền đen ở góc dưới-phải, chỉ trong MRI Volume. Kéo vòng đỏ (axial) xoay trái/phải, vàng (sagittal) xoay lên/xuống, xanh lá (coronal) xoay xiên; kéo nền vẫn xoay tự do.
- Đồng bộ README, thông số MPR, acceptance checklist và design-board HTML; giữ các entry lịch sử gizmo cũ bên dưới.

## 2026-10-07 — Compact MRI volume rotation gizmo

### Changed

- Thay orientation controller đa diện lớn bằng ba mũi tên trục mảnh ở góc trên-phải của riêng viewport MRI Volume; click một đầu trục để snap camera, kéo nền để xoay tự do.
- Bỏ vòng/nhãn Roll-Pitch-Yaw. Kéo plane MPR dùng trục chiếu màn hình rõ nhất và normal/camera của đúng viewport thay vì trộn hai trục màn hình.
- Camera volume độc lập với vị trí/crosshair MPR. Cập nhật đặc tả, acceptance, README và design board.

## 2026-10-07 — Match gizmo colors to MPR planes

### Changed

- Trục superior/inferior dùng màu axial; left/right dùng màu sagittal; anterior/posterior dùng màu coronal.
- Đồng bộ màu mũi tên, đầu mũi tên và hit target với legend/MPR plane colors để giữ cùng một quy ước thị giác.

## 2026-10-07 — Direct rotation from the volume gizmo

### Changed

- Đưa gizmo ba trục nền đen xuống góc dưới-phải của MRI Volume.
- Click đầu trục để snap hướng; kéo đầu trục quanh tâm gizmo để xoay camera trực tiếp quanh trục tương ứng. Giữ thao tác kéo nền để xoay tự do.
- Cập nhật tài liệu và acceptance để kiểm tra click/drag chỉ tác động camera MRI Volume.

## 2026-10-07 — Patient-specific MPR as Overview

### Changed

- Đưa 3D MRI volume và ba mặt phẳng MPR cùng-series lên tab `Overview`; bỏ tab MPR riêng để tránh trùng luồng.
- Bỏ model giải phẫu tham khảo chung khỏi Overview chính; ba tab hướng tiếp tục mở acquisition gốc và `Images / Series` vẫn là nơi duyệt series.
- Thêm ba layout Overview cho bốn viewport đồng bộ; đổi lựa chọn hiển thị thành `Standard MR` / `Angio-style (experimental)` và tách phép chiếu `Composite` / MIP thật.
- Đồng bộ README, workflow, viewer/design specs và design-board HTML; nhắc rõ Angio-style chỉ đổi cách hiển thị, còn FS/fluid do acquisition quyết định.

## 2026-10-07 — 3D orientation controller

### Changed

- Thêm orientation guide tương tác ở góc phải trên của MRI volume 3D; click mặt hướng để camera xoay về hướng đó, vẫn có thể kéo nền để xoay tự do.
- Dời legend ba mặt phẳng xuống góc trái dưới để không chồng lên guide; đổi help text/README/spec cho thao tác mới.

## 2026-10-07 — MPR slice planes on MRI volume

### Changed

- MPR volume 3D chiếu ba plane màu axial/sagittal/coronal từ tọa độ world và bounds của volume hiện tại; plane cập nhật theo slice và camera.
- Chọn plane rồi kéo theo hướng pháp tuyến hoặc wheel trong khung 3D để thay lát tương ứng; kéo vùng trống tiếp tục xoay camera.
- Cập nhật README, đặc tả MPR, acceptance gate và design-board HTML. Đây vẫn là volume intensity rendering, không phải segmentation hay công cụ chẩn đoán.

## 2026-10-07 — Interactive anatomy reference in Overview

### Changed

- Thay locator cube bằng GLB “Knee, Male, Right” từ NIH 3D / Human Reference Atlas; drag để xoay, scroll để zoom, có reset view.
- Thêm credit/attribution CC BY 4.0 và cảnh báo model chung không phải anatomy bệnh nhân, không mapping MRI slices.
- Giữ riêng khối volume MRI trong MPR; docs phân biệt cả hai khái niệm 3D.

## 2026-10-07 — Rotatable 3D volume in MPR

### Changed

- Thêm viewport Cornerstone volume 3D render từ chính DICOM volume đang cấp cho ba mặt MPR; drag trái để xoay camera và Reset về mặc định.
- MPR workspace chuyển thành lưới 2×2, thêm lựa chọn `MR-Default`, `MR-Angio`, `MR-MIP`; MPR slices và crosshair giữ nguyên hướng khi camera 3D xoay.
- Làm rõ MR fluid-sensitive/FS là đặc tính sequence; W/L và preset 3D chỉ thay cách ánh xạ intensity khi hiển thị, không thay voxel hay chạy AI.
- Cập nhật README, đặc tả native viewer và design board.

## 2026-10-07 — Branch strategy and MPR interaction

- `dev` là nhánh tích hợp và chạy CI mỗi lần push; `main` là nhánh deploy sau khi review/merge. CI cũng chạy cho Pull Request.
- Feature mới bắt đầu từ `dev`, được push trên branch riêng và review qua PR vào `dev`; chỉ đưa `dev` vào `main` khi deploy.
- Cho phép drag reference line để nhảy giao điểm crosshair trên MPR; click line / crosshair liên kết ba mặt phẳng.

## 2026-10-08 — Folder import and upload progress

### Changed

- Tách rõ picker chọn nhiều `.dcm`/`.zip` với nút `Choose a folder of DICOM files` hiển thị ngay dưới nút import; không còn quảng cáo folder trong nút mở file picker.
- Thay trạng thái ingest full-width bằng progress card trong sidebar, hiển thị phần trăm/dung lượng và ETA ước lượng cho giai đoạn truyền dữ liệu.
- Khi file đã tới VM, UI báo đang validating/indexing và không bịa ETA cho thời gian xử lý backend chưa đo được.
- Cập nhật app README và [13 — Input formats](13-input-formats-and-example-studies.md).

## 2026-10-06 — Current

### P1 — Native DICOM và single-series MPR

- Thay PNG/CSS trong reading view bằng Cornerstone3D 5.11.5; giữ PNG cho inventory thumbnails. W/L thật, native tool geometry, fit-minimum zoom, per-cell slice/camera, inline arrow notes, eraser và viewport capture.
- Thêm tab MPR: một acquisition → ba orthographic views + linked crosshair. Backend từ chối thiếu/không đều geometry, duplicate position, mixed frames/dimensions/pixel formats và volume vượt budget; không ghép acquisition khác nhau.
- Thêm endpoint raw DICOM byte-exact và volume eligibility; 24 pytest cases tổng cộng cùng Ruff/Mypy.
- Tách runtime, volume preload, capture, orientation labels, tool/layout pickers thành module nhỏ. Series selection giữ acquisition đang chọn khi có nhiều series cùng hướng.
- Docker và frontend CI dùng Node 24; lockfile gồm peer dependencies để npm ci chạy sạch.
- Cập nhật README, API spec, viewer spec, CI plan và design-board.html; thêm [16 — Native DICOM/MPR](16-native-dicom-and-mpr.md).
- Giới hạn: chưa patient-specific 3D, persisted annotations, DICOM SR hay clinical validation; transitive npm advisories cần xử lý trước public deployment. Mục P0 bên dưới là lịch sử, không còn mô tả renderer hiện tại.

### Added

- `.github/workflows/ci.yml`: backend Ruff/Mypy/compile, frontend build và Docker image build.
- `knee-web/requirements-dev.txt` và `knee-web/pyproject.toml` cho dev checks.
- [CONTRIBUTING.md](../CONTRIBUTING.md) với branch strategy, Conventional Commits, cách push và lộ trình CD.
- [15 — CI/CD plan](15-ci-cd-plan.md).

### Fixed

- `knee-web/requirements-dev.txt` dùng `-r backend/requirements.txt`, khớp với vị trí thật của production dependencies khi workflow chạy trong `knee-web`.
- Thêm `knee-web/tests/test_api.py` với 6 backend contract tests; CI chạy pytest cho ZIP upload, seed idempotency, read-only example và cleanup study upload.

### Viewer update

- Upload nhận thêm `.zip` không mã hóa; backend đọc các member `.dcm` hợp lệ và không cho phép path traversal.
- `results.zip` trong thư mục examples được seed thành example read-only khi Compose khởi động; member được flatten tên file để tránh Windows MAX_PATH.
- Overview có rail slice riêng cho từng series; wheel trên card active đổi slice và chặn scroll lan ra trang.
- Focused viewport dùng Pointer làm tool mặc định; mỗi ô có rail dọc ở bên phải để scrub slice, footer giữ tên series và chỉ số slice không che controls.
- Zoom/reset được đặt riêng trong từng viewport; zoom không nhỏ hơn fit 100%, không có max nhân tạo, và focused series mới mở từ slice 1 thay vì slice giữa.
- Direction tabs có preset layout `1x1`, `2x2` và custom grid tối đa `4x4`; mỗi viewport có slice slider/prev/next, wheel navigation và Sync slices.
- Layout controls được gom thành một dropdown; custom picker hiển thị bảng 4×4 và preview vùng khi hover trước khi click áp dụng.
- Gộp Length, Rectangle, Ellipse, Freehand và Arrow + note thành tool dropdown; Pointer là mặc định để chọn viewport, đổi slice và pan khi đã zoom.
- Length/shape hiển thị px hoặc mm/dimension khi PixelSpacing hợp lệ; Arrow + note mở inline editor thay cho browser prompt.
- Thêm `Undo mark`/`Clear slice marks`; mark được gắn theo viewport và slice hiện tại để có thể sửa thao tác nhầm.
- Overview có lựa chọn `3D four-up`, `3D primary`, `3D main`; image stage dùng nền đen để khớp MRI.
- Crosshair vẫn disabled khi study chưa mapping-ready; MPR/calibrated mm measurement/DICOM SR để phase sau.

### Changed

- `main.py`: chuẩn hóa đọc numeric DICOM value và sửa các lỗi Mypy.
- Các tài liệu chính có metadata ngày cập nhật và liên kết changelog.

### Git history

| Commit | Nội dung |
|---|---|
| `091cc23` | Add baseline CI checks |
| `1b1ffe3` | Split viewer into reusable React components |
| `7259c45` | Build local knee DICOM review service |

## 2026-10-05 — Local viewer scope

### Historical decision recorded in docs

- Chuyển trọng tâm sang local Docker viewer: upload `.dcm`, một example study, xem Study → Series → slices.
- Không auth, chưa AI/Triton/GCP trong release local.
- Analyze giữ ở dạng placeholder; patient-specific 3D/MPR để phase sau.

Nguồn chi tiết: [12 — Build steps](12-local-docker-build-steps.md), [13 — Input/examples](13-input-formats-and-example-studies.md), [11 — Team plan](11-team-rebalance-and-vibe-frontend.md).

## 2026-09-30 — Superseded planning

- Kế hoạch ban đầu có scope AI, cloud, authentication và Triton/GCP.
- Những phần này được giữ để tham khảo trong các file 06, 07 và 09 nhưng không phải release gate của local viewer hiện tại.

## Format cho entry mới

Dùng các nhóm `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`, `Security` khi phù hợp. Mỗi thay đổi code đáng kể nên liên kết commit/PR; mỗi thay đổi scope hoặc contract nên cập nhật tài liệu liên quan trong cùng PR.
