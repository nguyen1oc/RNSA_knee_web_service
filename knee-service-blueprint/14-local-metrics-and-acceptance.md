# 14 — Metrics đánh giá viewer và load test

> **Tài liệu kế hoạch ban đầu:** Một số tiêu chí dưới đây được viết trước khi nối Triton và trước bài benchmark staging.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Các mục dưới đây là danh sách kiểm thử viewer được lập ban đầu, không phải báo cáo trạng thái hiện tại. Analyze hiện dùng API/Triton trên staging. Xem [hướng dẫn k6](benchmarks/README.md) và [kết quả tải staging](benchmarks/2026-10-13-staging-load-report.md) để biết số đo mới nhất. Bài tải nhỏ chưa chứng minh độ chính xác y khoa hoặc số người dùng tối đa.

## 1. Bộ metric tối thiểu cần ghi

| Nhóm | Metric | Cách đo | Mục tiêu/điều kiện ban đầu |
|---|---|---|---|
| Đúng dữ liệu | Study grouping accuracy | Import sample và folder/files `.dcm`; so StudyInstanceUID/SeriesInstanceUID với manifest expected | 100%; không tách `series_1`/`series_2` thành hai study |
| Đúng dữ liệu | Slice order correctness | So thứ tự manifest với thứ tự geometry/reference; kiểm tra đầu/giữa/cuối stack | 100% trên fixture đã chốt |
| Đúng dữ liệu | Series selection correctness | Click từng series, kiểm tra label/UID/ảnh đầu tiên và ảnh cuối | 100%; không hiển thị ảnh cũ dưới label mới |
| Đúng dữ liệu | Pixel/render fidelity | So một số slice với viewer/reference; kiểm tra rows/columns, photometric, rescale, MONOCHROME1 | Không đảo sáng/tối hoặc sai shape; sai phải block release |
| Import | Import success rate | Số upload DICOM hợp lệ đạt READY / tổng upload hợp lệ | 100% trên P0 fixture |
| Import | Partial/error classification | File hỏng/unsupported/thiếu geometry | 100% có code/warning; không silent skip |
| Import | Pipeline stage completeness | Kiểm tra `validate`, `metadata`, `group`, `sort`, `preview` trong study payload/endpoint | Bốn stage đầu complete; preview on-demand; không thiếu stage |
| Import | Geometry-aware sort method | So `sort_method` và ảnh đầu/giữa/cuối với vị trí DICOM | Physical position khi đủ geometry; fallback rõ khi thiếu |
| Import | Geometry manifest correctness | So `geometry_status`, IOP/IPP, normal, FrameOfReferenceUID, position range và slice spacing với fixture | Status đúng `valid/partial/incompatible/unknown`; không giả mapping khi frame khác |
| Import | Unsupported input handling | Thử ZIP/PNG/JPG hoặc file không phải DICOM; kiểm tra thông báo rõ và không tạo study rác | Bị từ chối đúng; không silent skip |
| Import | Duplicate/conflict behavior | Import lại cùng checksum và cùng SOP khác checksum | Reuse đúng; conflict không overwrite |
| Xóa | Delete correctness | Xóa study upload rồi kiểm tra list, API, file storage và DB | Study biến mất hoàn toàn; không đụng sample/study khác |
| Xóa | Delete safety | Thử xóa sample, study đang index, study không tồn tại, cleanup lỗi | Đúng lỗi `EXAMPLE_READ_ONLY`/`STUDY_BUSY`/`NOT_FOUND`/`DELETE_FAILED` |
| Xóa | Delete latency | Từ confirmation đến job terminal, tách cleanup file và DB | Ghi p50/p95 thực; không đặt số trước benchmark |
| Bền vững | Restart recovery | Kill/recreate API, worker, web ở các stage upload/index/commit/delete | Không mất committed data; job không RUNNING mãi |
| Bền vững | Seed idempotency | Restart và seed lại 3 lần | Vẫn đúng 1 sample study; số series và ảnh phải khớp với fixture của môi trường |
| Bền vững | Backup restore | Restore DB + raw files vào volume sạch | Count/checksum và mở ảnh khớp bản gốc |
| Hiệu năng | Upload throughput | MiB/s cho sample, tách browser→API và disk write | Ghi p50/p95; so trên cùng máy/network |
| Hiệu năng | Index duration | Từ complete đến READY/PARTIAL, theo stage validate/extract/index/commit | Ghi p50/p95 trên ít nhất 5 lần; không gọi một lần là p95 |
| Hiệu năng | First image time | Click Mở ảnh đến khi viewport đầu tiên hiển thị đúng | Tách cold/warm; ghi n và fixture |
| Hiệu năng | Cached slice switch | 100 lần chuyển lát trong cùng series | Mục tiêu thử p95 ≤100 ms, đo trên máy/browser ghi rõ |
| Hiệu năng | Memory stability | Mở/đổi study và series 10 lần; ghi browser JS heap nếu có + task manager | Không tăng liên tục; chênh lệch cuối/cuối cần giải thích |
| API | Error response correctness | Upload lỗi, delete sample, storage unavailable, queue full | Status/code/message/action tiếp theo nhất quán |
| UX | Task completion | Người dùng nội bộ thực hiện upload → mở → đổi series → xóa upload | 100% hoàn thành không cần can thiệp dev trên script nghiệm thu |
| UX | Error recovery | File lỗi, ZIP lỗi, delete lỗi, restart giữa job | Biết bước tiếp theo; không mắc ở loading |
| UX | Study tree behavior | Expand/collapse study và series; click caret, click label, kiểm tra selected series | Không mở nhầm study/series; không render hàng trăm filename mặc định |
| UX | Analyze safety | Bấm Analyze ở sample và study upload | Khi thành công, hiện 12 scores từ API; khi lỗi, báo lỗi rõ ràng. Không tạo scores giả hoặc gọi điểm 0 là kết quả âm tính |
| UX | Per-study analysis state | Analyze study A, chuyển study B rồi quay lại A; refresh cùng tab; xóa study/Clear session | A giữ đúng kết quả và panel mode, B không nhận nhầm kết quả; refresh còn trong sessionStorage; xóa study hoặc Clear session dọn entry |
| UX | Return to study information | Ở AI Analysis bấm `Study information` | Panel quay lại Study Information cho đúng study; Analyze mở lại panel AI |
| UX | Display control behavior | Đổi contrast/brightness/invert rồi reset; so source image/API response | Thay đổi presentation có thể quan sát; Reset về default; DICOM nguồn không đổi |
| UX | Direction tab behavior | Click Overview, Sagittal, Coronal, Axial, Images / Series; kiểm tra Overview fit nhỏ gọn 4 ô, tab hướng viewport lớn fit trọn ảnh, Images / Series hiển thị browser series | 100%; không nhầm series/plane, tab không làm mất active slice |
| UX | Card selection and slice control | Click vùng ảnh SAG/COR/AX trong Overview, kiểm tra active series, footer `current / total`, Previous/Next Slice, zoom/pan và nút Open | Click card giữ Overview; chỉ card active nhận Slice/zoom/pan/reset; card khác không bị thay đổi; Open chuyển đúng tab hướng |
| UX | Image centering | Kiểm tra ảnh vuông và ảnh không vuông trong Overview/focused viewport ở các kích thước màn hình | Ảnh căn giữa ngang/dọc, giữ aspect ratio, không bị dồn xuống đáy |
| UX | Viewport zoom/pan/reset | Chọn lần lượt từng card, dùng Zoom controls, thử Zoom out tại 100%, kéo pointer khi zoom, bấm `Reset view` trên card và `Reset` trên toolbar | Chỉ card active thay đổi zoom/pan; không zoom nhỏ hơn fit 100%; không có max nhân tạo; zoom quanh tâm viewport, không tự lùi xuống/đổi tâm; reset đưa ảnh về fit |
| UX | Overview aspect ratio | So sánh ảnh SAG/COR/AX trong Overview với native dimensions; kiểm tra ảnh không méo và ô đủ lớn để scan nhanh | Ảnh giữ aspect ratio; không bị ép thành cùng width/height hoặc letterbox quá mức |
| UX | Overview slice rail and scroll lock | Trong Overview dùng slider SAG/COR/AX và lướt trên rail/card active | Rail từng series đổi đúng từng slice; slider khóa trong lúc ảnh đích loading; chỉ rail/card active thay đổi; body scrollbar không di chuyển |
| UX | Focused multi-view layout | Trong Sagittal/Coronal/Axial mở một Layout dropdown, chọn `1x1`, `2x2`, rê chuột trên bảng 4×4 để preview và click vùng tới `4x4`; kiểm tra cùng series, label viewport và slice position | Đủ viewport, không lẫn series/hướng, ảnh giữ aspect ratio; grid không vượt 16 ô |
| UX | Focused viewport ownership | Click viewport A/B/C/D, dùng rail slice/zoom/pan/reset và đổi active viewport | Chỉ viewport được chọn nhận thao tác; viewport khác giữ state; mỗi ô có control riêng |
| UX | Vertical slice rail | Mở direction mới và dùng slider bên phải từng viewport ở layout 1x1/2x2 | Series mới bắt đầu ở `1 / total`; slider đổi đúng ô được chọn và khóa khi ảnh chưa load; wheel trên rail đổi từng slice; các ô khác không đổi khi Sync slices tắt |
| UX | Pointer default and local zoom | Không chọn tool vẽ, click từng viewport, bấm `+`, kéo ảnh sau zoom và bấm `Reset` tại ô | Tool mặc định là Pointer; zoom/pan/reset hoạt động trên viewport đang chọn; zoom out bị khóa ở fit 100% |
| UX | Slice synchronization | Bật/tắt `Sync slices`, kéo range hoặc dùng prev/next trong từng viewport, sau đó dùng toolbar | Tắt: chỉ viewport active/viewport được thao tác đổi; bật: các viewport cùng series đổi cùng index |
| UX | Wheel slice navigation | Chọn Pan, đặt con trỏ trên viewport, lướt xuống/lên ở layout 1x1/2x2 | Xuống tăng slice đúng một bước, lên giảm một bước, không đổi zoom và không scroll trang |
| UX | Tool affordance and measurement labels | Mở tool picker và tạo Length/Rectangle/Ellipse khi có/không có PixelSpacing | Mỗi tool có icon dễ nhận biết; số đo dùng font dễ đọc và hiển thị px hoặc mm đúng trạng thái calibration |
| UX | Preview annotation tools | Chọn dropdown Length/Rectangle/Ellipse/Freehand/Arrow + note; vẽ trong viewport; kiểm tra label và editor; đổi slice | Overlay đúng viewport + slice; Length/shape có px hoặc mm khi PixelSpacing hợp lệ; Arrow + note mở editor inline; không đổi DICOM nguồn |
> Wheel slice test uses the default `Pointer` tool; “Pan” in the older row above is historical wording.
| UX | Delete preview marks | Vẽ nhiều mark trên cùng slice, bấm `Undo mark`, rồi `Clear slice marks`; đổi slice kiểm tra mark cũ | Undo xóa đúng mark cuối; Clear xóa toàn bộ mark của slice hiện tại; không xóa mark ở slice khác |
| UX | Image capture | Mở Capture, đổi PNG/JPEG và 64×64/128×128/512×512, bật/tắt annotation và metadata | Preview cập nhật đúng lựa chọn; download đúng format/kích thước; overlay theo lựa chọn; filename có hướng và slice; 512×512 là mặc định |
| UX | Crosshair gating | Kiểm tra study geometry incompatible/unknown và nút Crosshair | Nút disabled, có lý do `Requires mapped MPR geometry`; không giả reference line khi chưa mapping-ready |
| UX | Overview layout | Trong Overview chọn `3D four-up`, `3D primary`, `3D main`; kiểm tra locator và ba native direction cards | Bố cục đổi đúng, không thay đổi series/slice state; locator luôn có nhãn orientation-only |
| UX | Design-board parity | So layout tabs, 4-slot viewer, Study information panel với `design-board.html` ở 1440×900 | Không mất region/chức năng; sai lệch được ghi trong report |

## 2. Công thức và cách ghi

- `import_success_rate = READY imports / valid imports`. Đừng đưa file unsupported vào mẫu số; báo unsupported rate riêng.
- `delete_success_rate = DELETED studies / delete requests accepted`. Request bị từ chối vì sample hoặc study đang bận là safety behavior, không phải cleanup failure.
- `p50` là median, `p95` là percentile 95. Ghi số mẫu `n`, fixture checksum, CPU/RAM/disk, browser/OS, Docker image và trạng thái cold/warm.
- Ghi timestamp `upload_started`, `upload_completed`, `index_started`, `index_ready`, `delete_requested`, `delete_started`, `delete_finished`, `first_image_rendered`.
- Không dùng `progress=100%` làm mốc READY. READY là khi manifest và raw assets đã commit, query được và mở được ảnh.

## 3. Load test cloud website (Vercel → Cloud Run)

### Metric nào đã có và metric nào chưa có?

Không nhầm **metric dữ liệu/viewer** với **metric hiệu năng hệ thống**:

| Nơi | Hiện trạng | Dùng để đánh giá |
|---|---|---|
| Study/Series UI và API payload | Có: số series/slices, rows × columns, plane, geometry status/valid series, pipeline stage status | Tính đầy đủ và khả năng đọc của study; không đo tốc độ website |
| Viewer measurement tools | Có: length/annotation và các công cụ đo trên ảnh | Đo/ghi chú trên viewport; không phải monitoring metric |
| Backend app telemetry | Chưa thấy custom request histogram, RPS dashboard, frontend RUM/Core Web Vitals hoặc OpenTelemetry/k6 script trong source hiện tại | Chưa có metric app-level để báo p95/error theo endpoint hay trải nghiệm người dùng |
| Cloud Run / Cloud Monitoring | Cloud Run có built-in metrics tự thu thập: request count/latency, instance count, CPU/memory utilization, startup latency, concurrent requests và billable instance time | Theo dõi backend khi test; mở Cloud Run service → Metrics hoặc Cloud Monitoring Metrics Explorer |
| Firestore / GCS | Dùng dịch vụ thật cho metadata/object; theo dõi operation/usage, bytes và billing trong Google Cloud | Phát hiện tải đọc/ghi/egress và chi phí tăng khi test |

`/api/health` chỉ là smoke check, không đại diện trải nghiệm viewer. Các số hiển thị như `5 series`, `284 slices` là inventory của study mẫu, không phải benchmark.

### Baseline staging đã chạy (2026-10-11)

- Endpoint: `https://knee-review-api-staging-jnbsqra6ma-as.a.run.app/api/health`
- Phép thử: 20 GET liên tiếp từ một client, không song song; response body phải có `status=ok`.
- Kết quả lần đo ban đầu: **20/20 HTTP 200**, 0 lỗi, elapsed 3.30 s, ~6.05 request/s tuần tự, p50 **161 ms**, p95 **212 ms**, min 115 ms, max 219 ms.
- Chạy lại bằng script: **20/20 HTTP 200**, 0 lỗi, elapsed 2.12 s, ~9.44 request/s tuần tự, p50 **64 ms**, p95 **196 ms**, min 53 ms, max 488 ms. Dao động giữa hai lần cho thấy mẫu nhỏ và thời gian mạng/client ảnh hưởng đáng kể; cần nhiều lần chạy hơn trước khi đặt SLO.
- Đây chỉ là sanity baseline của health route ở một thời điểm, không phải concurrency/capacity, không đo Firestore/GCS, frontend, login/session, study listing, DICOM download hay decode/render. Không dùng số này để tuyên bố SLA.
- Lần đo script có max 488 ms trong khi p95 196 ms; giữ cả max và percentile, không che spike bằng average.
- Chạy lại từ repo root bằng `powershell -ExecutionPolicy Bypass -File .\knee-web\scripts\staging-health-baseline.ps1`; script mặc định 20 requests tuần tự và hỗ trợ `-ApiBaseUrl`/`-Iterations`. Giữ số liệu kèm timestamp/revision; các lần chạy khác có thể khác do cold start/network.
- Vercel Preview domain hiện bật Deployment Protection; lệnh HTTP tới URL Preview bị chuyển sang trang đăng nhập Vercel. Vì vậy phép đo trên gọi trực tiếp staging Cloud Run, không đo Vercel→Cloud Run end-to-end. Với demo browser, đăng nhập Preview và kiểm tra session, sample study, chọn series, tải slice; không tắt protection để chạy benchmark.

### Cách chạy an toàn

1. Chỉ bắt đầu trên **staging/Preview đã giới hạn người truy cập**; không chạy stress test trên production. Chỉ dùng sample public hoặc dữ liệu đã de-identify.
2. Đo baseline một VU trước. Đã có smoke baseline 20 request tuần tự cho `/api/health`; bước kế tiếp là k6 luồng có gate/session khi có credential local, rồi ramp nhẹ: **1 VU × 1 phút → 5 VUs × 2 phút → 10 VUs × 2 phút → ramp down**. Đây là profile khởi đầu, không phải tuyên bố hệ thống chịu được 10 người dùng thực.
3. Dừng ngay nếu 5xx/error rate tăng rõ, p95 tăng hơn gấp đôi baseline liên tiếp, API bắt đầu timeout/429 bất thường, hoặc CPU/memory/chi phí tăng nhanh. Không vượt qua rate limit để tạo tải.
4. Chạy luồng đọc trước: mở trang → tạo session → list/open sample study → tải một vài DICOM/slice. Tách test upload thành lượt riêng, chỉ dùng ZIP nhỏ và ít VUs; không lặp ZIP mẫu ~430 MiB.
5. Sau mỗi lượt, xóa session test, lưu k6 output và khung thời gian để đối chiếu với Cloud Run/Firestore/GCS metrics. Nếu Vercel Deployment Protection chặn test runner, dùng cấu hình QA được cấp phép; không public token gate để né protection.

### Metric cần ghi

| Nhóm | Metric | Ghi chú |
|---|---|---|
| k6/API | Request rate (req/s), p50/p95/p99 latency theo endpoint, failed-request rate và status code | Đừng chỉ xem average; tách `/api/sessions`, list/open study, slice/DICOM và upload/finalize |
| k6/workflow | Iteration duration, checks passed/failed, VUs, bytes sent/received | Mô phỏng session cookie riêng theo VU; kiểm tra response content/status đúng chứ không chỉ trả nhanh |
| Browser thật | Navigation/LCP, thời gian ảnh DICOM đầu tiên render, thời gian MPR ready, slice-change latency, memory sau khi đổi study lặp lại | Protocol-level k6 tải HTTP nhưng không đo decode/render pixels hoặc thao tác canvas; dùng một lượng nhỏ browser VUs để đo UX |
| Cloud Run | Request count/latency, instance count, CPU, memory, startup latency, maximum concurrent requests, billable instance time | Đối chiếu đúng service/revision và cùng time window với k6 |
| Firestore/GCS | Reads/writes/deletes, bytes/object operations và chi phí/quota | Upload test tốn tài nguyên thật; theo dõi billing sau test |

Đặt thresholds trong k6 sau khi có baseline và SLO đã thống nhất. Ví dụ ngưỡng khởi đầu có thể là failed requests `<1%`, nhưng phải loại trừ status 4xx vốn là expected behavior của test case; chưa chốt latency target cho staging. k6 phân biệt checks (đúng chức năng) với thresholds (pass/fail về hiệu năng). Tham khảo [k6 API load testing](https://grafana.com/docs/k6/latest/testing-guides/api-load-testing/) và [Cloud Run monitoring](https://docs.cloud.google.com/run/docs/monitoring).

**Giới hạn cấu hình hiện tại:** workflow Cloud Run đặt `max instances = 1` và `concurrency = 1` để khống chế chi phí. Vì thế test sẽ sớm thấy request queue/latency khi có request đồng thời; ghi nhận đây là cấu hình hiện tại, không tự tăng limit hoặc test tới mức gây hóa đơn bất ngờ.

### Checklist demo/thuyết trình

1. Nói rõ kiến trúc: frontend trên Vercel; FastAPI trên Cloud Run; DICOM private trong GCS; metadata/session/rate-limit trong Firestore; staging là QA, production là public. Cloud Run health xanh chỉ xác nhận API process đáp ứng, không chứng minh mọi luồng viewer đã được nghiệm thu.
2. Demo browser trên staging Preview đã được bảo vệ: tạo temporary session → mở shared sample → mở một series → xem/tải một vài slice → Clear session. Dùng sample public/de-identified, không dùng DICOM bệnh nhân thật.
3. Nêu test đã có: 20/20 health GET thành công; p50 161 ms/p95 212 ms ở phép đo tuần tự trực tiếp Cloud Run. Nêu rõ chưa có concurrency test, chưa có browser rendering timing, và không suy ra số người dùng tối đa từ health route.
4. Nếu được hỏi “chịu được bao nhiêu người?”: trả lời chưa xác định; cấu hình hiện tại `max instances=1`, `concurrency=1`, cần test tăng dần trên staging và theo dõi 5xx/429/p95/CPU/memory/Firestore/GCS trước khi đưa ra con số.
5. Nếu được hỏi “an toàn dữ liệu?”: giải thích staging gate + anonymous temporary session + session-scoped ownership + bucket private; chỉ dùng dữ liệu de-identified. Đây là research/demo, chưa phải thiết bị chẩn đoán hoặc hệ thống clinical-grade.
6. **Ghi chú lịch sử:** câu trả lời “AI chưa chạy, 12 score 0% là UI fallback” chỉ đúng trước khi nối Triton. Hiện staging đã chạy Analyze qua Triton; xem [báo cáo benchmark](benchmarks/2026-10-13-staging-load-report.md) và [tài liệu bàn giao](21-project-handover.md).
7. Kết thúc bằng rủi ro/việc tiếp theo: chạy browser smoke qua Preview, test k6 theo session trên staging, hoàn tất Terraform import/plan rồi review drift; không chạy stress trên production.

## 4. Bộ test chạy trước bàn giao

1. Seed `results.zip`: xác nhận một `study_id`, 5 series và 284 assets; mở cây Study → Series → DICOM.
2. Upload lại một ZIP làm study user; so catalog, order và số ảnh với example.
3. Upload nhiều file `.dcm`; kiểm tra grouping không phụ thuộc thứ tự file được chọn.
4. Thử ZIP/PNG/JPG và file `.dcm` hỏng; kiểm tra bị từ chối hoặc report rõ, không silent skip.
5. Xóa study upload; refresh trang, gọi lại catalog, kiểm tra raw path và DB không còn asset của study đó.
6. Thử xóa sample; kiểm tra bị từ chối với HTTP 409 và example vẫn còn.
7. Restart Compose; kiểm tra recovery, seed idempotency và không xóa nhầm.
8. Restore một bản backup vào volume mới; mở lại sample và một study upload chưa xóa.
9. Kiểm tra cây Study → Series → slice, Analyze notice, direction tabs và display controls/reset.
10. Dùng Zoom controls và pointer drag pan ở Overview lẫn focused direction; trong focused direction dùng wheel đổi slice lên/xuống và kiểm tra ảnh không bị fit constraint khi zoom.
11. Gọi `GET /api/series/{id}/geometry` và đối chiếu manifest với DICOM header; kiểm tra study summary báo `Incompatible frames` khi các series không cùng FrameOfReferenceUID.
12. Chạy performance smoke trên cùng fixture, ghi p50/p95 và evidence.
13. Trong focused tab kiểm tra một Layout dropdown với preset/custom tới 4x4, hover preview, slice slider/prev/next, wheel navigation, Sync slices, dropdown tools/metrics, annotation editor và Capture PNG/JPEG.
14. Chạy `python -m pytest -q`; tất cả test ZIP, seed, read-only delete và cleanup phải pass.

## 5. Release gate

Block bàn giao nếu có: sai Study/Series UID, sai slice order, ảnh cũ dưới tên series mới, mất file sau restart, xóa nhầm sample/study khác, cleanup báo thành công nhưng file còn lại, job treo RUNNING, hoặc lỗi import bị bỏ qua không báo.

Có thể bàn giao với metric hiệu năng chưa đạt mục tiêu nếu đã ghi số đo thật và lý do. Không bàn giao khi chưa biết metric đo trên fixture/máy nào.
