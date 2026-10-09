# Knee Review — kế hoạch local Docker

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Bỏ kế hoạch Firebase/account; chuyển sang temporary anonymous session, TTL, upload caps và cleanup; giữ các feature đã merge vào `dev`.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Cập nhật **05/10/2026** là mốc local viewer ban đầu; temporary session/public-demo planning được chốt ngày 09/10, còn model/Triton deferred. App vertical slice chạy tại `../knee-web`; bộ docs mô tả trạng thái và các bước tiếp theo.

Bắt đầu bằng [12 — Các bước build local](12-local-docker-build-steps.md), sau đó đọc [13 — Input và example studies](13-input-formats-and-example-studies.md). Lịch hiện hành ở [11](11-team-rebalance-and-vibe-frontend.md).

## Tài liệu nào dùng hiện tại?

| File | Vai trò | Trạng thái |
|---|---|---|
| [00 Workflow](00-user-workflow-features.md) | Trang đầu, upload và xem ảnh | Local hiện hành |
| [01 Scope](01-product-scope.md) | P0/P1, định nghĩa hoàn thành | Local hiện hành |
| [02 Viewer](02-viewer-dicom-spec.md) | DICOM, series/FS/fluid, Overview MPR/volume và hướng gốc | Mô hình thông tin + lịch sử P0; hành vi hiện tại ở [16](16-native-dicom-and-mpr.md) |
| [03 Design](03-design-system.md) | Theme sáng, font, controls, tree và Analyze placeholder | Hiện hành; panel AI để sau |
| [04 Architecture](04-architecture-data.md) | Docker, SQLite, storage, index worker | Local hiện hành |
| [05 API v0.2](05-api-contract.md) | Upload, examples, studies, image manifest | Local hiện hành |
| [06 Model/Triton](06-ai-triton-contract.md) | Kiến thức và contract AI | Hoãn, không là gate local |
| [07 Lịch ban đầu](07-two-person-plan.md) | Kế hoạch AI/cloud cũ | Lịch sử, không thực thi |
| [08 QA](08-qa-release.md) | Kiểm tra local và persistence | Local hiện hành |
| [09 GCP](09-gcp-runbook.md) | VM staging, public topology và rollout | Staging hướng dẫn hiện hành; production chờ GCS/Cloud SQL |
| [10 Decisions](10-decisions-risks.md) | Quyết định, rủi ro, phần chưa chốt | Quyết định 05/10 ưu tiên |
| [11 Hai người](11-team-rebalance-and-vibe-frontend.md) | Ownership, ngân sách và lịch 10 ngày | Local hiện hành |
| [12 Build steps](12-local-docker-build-steps.md) | Làm từng bước và giải thích Triton | Điểm bắt đầu |
| [13 Input/examples](13-input-formats-and-example-studies.md) | Format, grouping, seed và storage | Hiện hành |
| [14 Metrics](14-local-metrics-and-acceptance.md) | Đánh giá đúng dữ liệu, xóa, restart, hiệu năng và UX | Hiện hành |
| [15 CI/CD](15-ci-cd-plan.md) | CI baseline và lộ trình staging/autodeploy | CI hiện hành; CD để sau |
| [16 Native DICOM/MPR](16-native-dicom-and-mpr.md) | P1 controls, geometry gate, runtime và giới hạn kiểm định | Viewer implementation hiện hành |
| [17 GCP basics](17-gcp-basics-and-first-deploy.md) | Project, billing, CLI/ADC, IAM, VM, IAP, Terraform, Triton và GKE | Hướng dẫn nhập môn và bước chuẩn bị staging |
| [18 Temporary workspace](18-anonymous-session-and-upload-limits.md) | Anonymous session, clear/reset, TTL, upload caps và public gates | Current decision; Cloud Run storage/rate limits remain |
| [CHANGELOG](CHANGELOG.md) | Lịch sử thay đổi đáng chú ý | Hiện hành |
| [CONTRIBUTING](../CONTRIBUTING.md) | Commit, branch, push, review và CI/CD | Hiện hành |
| [15 CI/CD](15-ci-cd-plan.md) | CI baseline và lộ trình staging/autodeploy | CI hiện hành; CD để sau |

## Mặc định để bắt đầu

- Không có tài khoản. Local/staging tạo temporary HttpOnly session; uploads được scope theo browser session, xóa được ngay và auto-expire.
- Một sample study gồm hai series mẫu và phần study upload. Hai series phải mở được; placeholder không tính hoàn thành.
- React/TypeScript/Tailwind + Cornerstone cho DICOM `.dcm`.
- Docker Compose: web, api, worker index và seed chạy một lần; chỉ web publish localhost.
- SQLite và raw uploads trong named volume. Examples từ thư mục host mount read-only; không COPY MRI vào image.
- Runtime không cần GPU NVIDIA, CUDA, checkpoint hoặc tài khoản GCP.
- UI sáng theo design tokens; vùng tối bên trong ảnh vẫn theo pixel gốc.
- Overview hiện có MRI Volume và MPR planes đồng bộ; chỉ dựng từ series đạt geometry validation.

## Dữ liệu sẵn có và phần còn thiếu

Kiểm kê `dicom-viewer/files`: 64 DICOM, 2 series, **1 study**. Đây là sample study hiện hành; `series_1` và `series_2` nằm trong cùng study. Chưa kiểm tra toàn bộ pixel/de-identification. Chi tiết ở file 13.

`dicom-viewer/` hiện chỉ là viewer đọc local trong browser. Service local đang chạy tại `knee-web/`, có FastAPI + SQLite + React build tĩnh + Docker Compose; xem [README của app](../knee-web/README.md).

## Templates

- [Design board](templates/design-board.html) và [CSS tokens](templates/design-tokens.css): mẫu tĩnh, không là viewer hoạt động.
- [Examples manifest](templates/examples-manifest.template.json): điền source/checksum trước seed; null là chưa sẵn sàng.
- [Task](templates/task-template.md) và [test report](templates/test-report-template.md).
- [Model contract](templates/model-contract.template.json): giữ cho giai đoạn AI sau.

## Hoàn thành local khi nào?

Compose khởi động được; một sample study với hai series mở được; file/folder DICOM `.dcm` nhập và xem được; study upload có thể xóa; refresh/recreate không mất catalog/raw files; cây Study → Series và Analyze placeholder hoạt động; thứ tự và nhãn ảnh đúng; có README và report kiểm thử thực. ZIP, model serving/cloud không nằm trong điều kiện hoàn thành vertical slice này.
