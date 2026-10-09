# Knee Review — kế hoạch local Docker

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Phân biệt staging VM riêng tư hiện tại với production chưa triển khai; mô tả đích URL cho reviewer và cảnh báo tài khoản demo mặc định.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Cập nhật **09/10/2026**: staging hiện tại là VM CPU riêng tư qua IAP, chưa có URL public và app chưa có login. `dev` là nguồn staging/review; `main` chỉ deploy production sau khi được duyệt. Đích public review là React trên Firebase Hosting + FastAPI trên Cloud Run. Account bootstrap dự kiến `admin123 / 123456`, có thể upload/xóa study thuộc UID của nó; muốn dữ liệu riêng thì mỗi reviewer phải có account riêng. Nếu dùng chung credential, study cũng dùng chung. Xem [09](09-gcp-runbook.md) và [18](18-auth-and-user-data-plan.md).

Bắt đầu bằng [12 — Các bước build local](12-local-docker-build-steps.md), sau đó đọc [13 — Input và example studies](13-input-formats-and-example-studies.md). Lịch hiện hành ở [11](11-team-rebalance-and-vibe-frontend.md).

## Tài liệu nào dùng hiện tại?

| File | Vai trò | Trạng thái |
|---|---|---|
| [00 Workflow](00-user-workflow-features.md) | Trang đầu, upload và xem ảnh | Local hiện hành |
| [01 Scope](01-product-scope.md) | P0/P1, định nghĩa hoàn thành | Local hiện hành |
| [02 Viewer](02-viewer-dicom-spec.md) | DICOM, series/FS/fluid, Overview MPR và hướng | Hiện hành |
| [03 Design](03-design-system.md) | Theme sáng, font, controls, tree và Analyze placeholder | Hiện hành; panel AI để sau |
| [04 Architecture](04-architecture-data.md) | Docker, SQLite, storage, index worker và ánh xạ staging GCP | Local hiện hành; GCP v0 là một VM riêng tư |
| [05 API v0.2](05-api-contract.md) | Upload, examples, studies, image manifest | Local hiện hành |
| [06 Model/Triton](06-ai-triton-contract.md) | Kiến thức và contract AI | Hoãn, không là gate local |
| [07 Lịch ban đầu](07-two-person-plan.md) | Kế hoạch AI/cloud cũ | Lịch sử, không thực thi |
| [08 QA](08-qa-release.md) | Kiểm tra local và persistence | Local hiện hành |
| [09 GCP](09-gcp-runbook.md) | Deploy staging VM trước; sau đó Cloud Run/Triton/GKE | Staging chưa AI; truy cập qua IAP, không public |
| [10 Decisions](10-decisions-risks.md) | Quyết định, rủi ro, phần chưa chốt | Quyết định 05/10 ưu tiên |
| [11 Hai người](11-team-rebalance-and-vibe-frontend.md) | Ownership, ngân sách và lịch 10 ngày | Local hiện hành |
| [12 Build steps](12-local-docker-build-steps.md) | Làm từng bước và giải thích Triton | Điểm bắt đầu |
| [13 Input/examples](13-input-formats-and-example-studies.md) | Format, grouping, seed và storage | Hiện hành |
| [14 Metrics](14-local-metrics-and-acceptance.md) | Đánh giá đúng dữ liệu, xóa, restart, hiệu năng và UX | Hiện hành |
| [15 CI/CD](15-ci-cd-plan.md) | CI baseline và lộ trình deploy staging/autodeploy | CI hiện hành; deploy staging v0 thủ công trước |
| [16 Native DICOM/MPR](16-native-dicom-and-mpr.md) | P1 controls, geometry gate, runtime và giới hạn kiểm định | Viewer implementation hiện hành |
| [17 GCP basics](17-gcp-basics-and-first-deploy.md) | Project, billing, CLI/ADC, IAM, VM, IAP, Terraform, Triton và GKE | Hướng dẫn nhập môn và bước chuẩn bị staging |
| [18 Auth and user data](18-auth-and-user-data-plan.md) | Identity Platform vs PostgreSQL, token verification, ownership, GCS và GPU/Triton separation | Plan trước khi mở multi-user |
| [CHANGELOG](CHANGELOG.md) | Lịch sử thay đổi đáng chú ý | Hiện hành |
| [CONTRIBUTING](../CONTRIBUTING.md) | Commit, branch, push, review và CI/CD | Hiện hành |
| [15 CI/CD](15-ci-cd-plan.md) | CI baseline và lộ trình staging/autodeploy | CI hiện hành; CD để sau |

## Mặc định để bắt đầu

- Hai trang: Danh sách study và Workspace; vào thẳng, một catalog chung, không đăng nhập.
- Một sample study gồm hai series mẫu và phần study upload. Hai series phải mở được; placeholder không tính hoàn thành.
- React/TypeScript/Tailwind + Cornerstone cho DICOM `.dcm`.
- Docker Compose: web, api, worker index và seed chạy một lần; chỉ web publish localhost.
- SQLite và raw uploads trong named volume. Examples từ thư mục host mount read-only; không COPY MRI vào image.
- Runtime không cần GPU NVIDIA, CUDA, checkpoint hoặc tài khoản GCP.
- Deploy cloud v0 không thay đổi local scope: dùng một VM CPU + Docker Compose; không dùng Triton/GPU/Kubernetes.
- Trạng thái hiện tại vẫn single shared catalog, không login/ownership. Multi-user release cần Identity Platform + FastAPI authorization; không lưu password trong PostgreSQL.
- UI sáng theo design tokens; vùng tối bên trong ảnh vẫn theo pixel gốc.
- Overview dựng MRI volume/MPR từ một series khi geometry hợp lệ; khi không hợp lệ, báo rõ và vẫn cho mở acquisition gốc.

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
