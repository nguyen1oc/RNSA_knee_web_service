# 07 — Kế hoạch 2 người / 10 ngày làm việc

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Chuẩn hóa metadata tài liệu; kế hoạch này vẫn là historical và không thay thế lịch local hiện hành.  
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

> **LỊCH SỬ — không thực thi từ 05/10/2026.** Scope AI/cloud/auth và lịch bên dưới đã bị thay bởi local viewer không auth. Dùng [11 — Hai người build local](11-team-rebalance-and-vibe-frontend.md) và [12 — Build steps](12-local-docker-build-steps.md). Các gate checkpoint/GCP/auth ở đây không áp dụng hiện tại.

## Năng lực và ngân sách

Giả định A có React/TypeScript, B có Python/model/Docker và cả hai làm gần full-time. Mỗi người 6 giờ tập trung/ngày × 10 ngày = 60 giờ. Kế hoạch 5 giờ/ngày/người = **100 person-hours**, còn **20 giờ dự phòng**. Họp/integration/review nằm trong 5 giờ đã lên lịch; không tính như tài nguyên miễn phí.

Ngày là D1..D10 tính từ kickoff, không cố định lịch. Nếu chỉ làm part-time hoặc checkpoint chưa chạy, phải giảm scope/chỉnh lịch. Không có thêm người QA/DevOps riêng.

## Ownership

| Người | Own | Review |
|---|---|---|
| A — Frontend / Viewer | UI, Cornerstone, geometry presentation, mocks, UX tests | Response contract, dữ liệu input/output hiển thị |
| B — Backend / ML / Infra | Upload/index/storage/auth, worker, model/Triton, GCP | Mapping hướng/lát, validation UI và state |

Một task chỉ một owner. Mỗi ngày 15 phút sync: đã chạy gì, đang vướng gì, contract có đổi không. D3/D5/D7/D9 có demo chung, nằm trong ngân sách giờ của ngày.

## Lịch và deliverable

Xem [feature map F01–F12](00-user-workflow-features.md) để biết mỗi task tạo hành vi nào trên màn hình. Thứ tự ưu tiên: **Danh sách/nhập study → một stack xem được → ba hướng và thao tác ảnh → input/job/kết quả AI → MPR/3D nâng cấp**. Spike model/geometry vẫn chạy D1–2 để phát hiện blocker sớm; không cộng thêm giờ ngoài bảng dưới.

| Ngày | A — tối đa 5h planned | B — tối đa 5h planned | Gate / phụ thuộc |
|---|---|---|---|
| D1 | FE-01: skeleton, tokens, layout; cùng chốt API mock | BE-01: kiểm tra checkpoint/offline, quota GPU, schema API | Cả hai ký model/API decision; checkpoint blocker phải lộ ngay |
| D2 | FE-02: thử loader/codec/MPR trên fixture, geometry spike | BE-02: index fixture + manifest; đo baseline model RAM/VRAM, aggregation | Chốt codec và P1 khả thi; model contract tối thiểu đầy đủ |
| D3 | FE-03: nối manifest thật, sidebar và stack viewer | BE-03: upload streaming, storage, inventory; auth cơ bản | Demo upload → xem một series thật; không chờ hết tuần mới tích hợp |
| D4 | FE-04: 4 ô, tab hướng, series switch, scroll/zoom/W-L | BE-04: worker/job bền vững, idempotency, recovery | Refresh giữ catalog; thao tác viewer không đổi model snapshot |
| D5 | FE-05: MPR/crosshair/locator trong giới hạn D2; lỗi geometry | ML-01: Triton wrapper, readiness; parity offline | Demo viewer + model riêng; bỏ P2 nếu P0 chưa xong |
| D6 | FE-06: panel input slots, AI state, polling/result | ML-02: nối preprocess/Triton/result; snapshot provenance | E2E study → job → score thật |
| D7 | FE-07: lỗi/empty/keyboard, đổi study, cache cleanup | BE-05: limits, owner auth, retries, retention | Demo hai phiên, lỗi codec, thiếu input, restart |
| D8 | QA-A: orientation/viewport/contrast/browser; sửa lỗi | QA-B: job recovery/parity/resource; backup/restore thử | Report có bằng chứng; critical failures phải đóng |
| D9 | FE-08: kiểm tra deployed build/worker assets, UX sửa cuối | OPS-01: GCP Compose, HTTPS, disk/secrets/health, rollback | Demo cloud từ máy khác; không chỉ localhost |
| D10 | DOC-A: guide sử dụng, nghiệm thu chéo backend | DOC-B: runbook, nghiệm thu chéo viewer, release manifest | 1 bản demo + test report + known limitations |

20 giờ dự phòng phân bổ khoảng 1h/người/ngày hoặc dồn sửa integration/codec/deploy; không lập thêm task P2 để lấp hết trước khi đạt P0. Nếu dùng hết buffer vẫn còn lỗi P0 thì thu hẹp supported dataset/format công khai hoặc lùi mốc, không gắn nhãn “done”.

## Critical path và hợp tác

BE-01/BE-02 (checkpoint + manifest) → FE-03 & ML-01 → ML-02/FE-06 → QA → OPS. A mock đúng schema từ D1 để không chờ backend; B dùng fixtures và API smoke client để không chờ UI. Đến D3 mock phải thay được bằng dữ liệu thật.

Đóng gói model trên GCP không chờ tới D9 mới thử GPU: kiểm tra quota/access D1, smoke GPU/container D2 khi tài nguyên đã được cấp; D9 là deployment hoàn chỉnh. GPU cloud được bật theo ca làm, giữ disk khi stop để tiết kiệm nhưng vẫn kiểm tra chi phí disk/IP.

## Quy tắc giảm scope

1. D2: geometry không đạt → giữ stack gốc; ô 3D có giải thích. Nếu bắt buộc 3D, chọn fixture phù hợp và chốt phạm vi hẹp rõ ràng.
2. D5: P0 chậm → bỏ volume rendering nâng cao, so đôi series, lưu camera lâu dài; giữ 4 ô, stack và W-L.
3. D6: model chưa parity → dành buffer cho model; không thay score thật bằng mock không nhãn.
4. Luôn giữ auth/owner check, orientation đúng, provenance và lỗi rõ; không cắt chúng để đẹp giao diện.

## Handoff mỗi ngày

- A cung cấp screenshot/clip ngắn dùng dữ liệu đã khử định danh + phiên bản FE + lỗi cần BE.
- B cung cấp fixture manifest, endpoint chạy được, response/error examples + model/API version.
- Cả hai cập nhật [decision log](10-decisions-risks.md), task theo [template](templates/task-template.md), và test theo [report](templates/test-report-template.md).
- Chỉ gọi “done” khi reviewer đã chạy hoặc xem bằng chứng theo acceptance; hoàn thành code chưa đủ.
