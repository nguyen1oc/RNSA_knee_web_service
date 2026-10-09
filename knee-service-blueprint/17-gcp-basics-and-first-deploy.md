# 17 — GCP nhập môn cho Knee Review

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Giải thích staging hiện tại qua IAP, chưa có URL public; `dev` deploy staging và `main` dành cho production.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Mục tiêu

Tài liệu này là glossary/runbook nhập môn cho hai người phát triển dự án. Scope trước mắt là đưa **viewer hiện tại** lên staging riêng tư, chưa có AI. Không cần tạo GPU, Triton hoặc Kubernetes ở bước này.

Trong project này, staging hiện tại là VM CPU `knee-review-staging-01` chạy Docker Compose, truy cập qua IAP tunnel tại `http://127.0.0.1:8081` trên máy đã mở tunnel. Nó chưa có domain/URL public, chưa có app login, và không phải nơi mời người dùng Internet upload study. Nhánh `dev` là nguồn staging; `main` là nguồn production sau review. Trạng thái cụ thể/đích URL-based frontend-backend xem [09 — GCP runbook](09-gcp-runbook.md).

## GCP là gì trong app này?

Google Cloud Platform là tập hợp dịch vụ cloud. Project là ranh giới quản lý tài nguyên, IAM, API, quota và billing. Dùng project riêng cho staging giúp tách tài nguyên khỏi các project khác.

Project ID hiện được cấu hình trong Google Cloud CLI là `rsna-knee-511004`. Đây chỉ là lựa chọn mặc định ở CLI; cần tự xác nhận project đã link billing account trước khi tạo tài nguyên.

## Trạng thái project đã xác nhận

Theo thông tin người dùng xác nhận ngày 2026-10-08:

- Project: `rsna-knee-511004`.
- Billing account: đã liên kết với project.
- Budget: đã tạo; số tiền, chu kỳ và ngưỡng cảnh báo chưa được ghi nhận.
- Google Cloud CLI: `core/project` đang trỏ tới `rsna-knee-511004`.
- VM `knee-review-staging-01`: người dùng báo đã tạo và đang chạy ở `asia-southeast1-a`; cấu hình được thấy gồm `e2-medium`, Debian 13, IPv4-only và không gắn external IPv4.
- Backup/replication: dự kiến `No backups`, không replication cho staging dùng sample; xác nhận lại ở VM details nếu cần.
- IAP: người dùng xác nhận network tag và firewall rule khớp; SSH qua IAP đã kết nối thành công rồi thoát phiên.
- Cloud NAT: người dùng báo đã tạo Public NAT tên `knee-review-nat` qua Cloud Router `knee-review-router`, VPC `default`, region `asia-southeast1`; IPv4 subnet ranges, Automatic NAT IP allocation và Standard network tier. VM vẫn không có external IPv4.
- Outbound: đã kiểm tra thành công bằng `apt-get update` và Docker Hub image pull.
- Docker Engine/Compose: cài trên VM; `docker run hello-world` và `docker compose version` thành công.
- Source: clone nhánh `dev` vào `/home/nguyenloc/knee-review`, commit `8f8d805` (merge PR #4); chưa lấy các sửa đổi local chưa commit.
- Example: `results.zip` được chuyển vào `/home/nguyenloc/knee-review/dicom-viewer/files/`; SHA-256 trên VM khớp file local.
- Ứng dụng: Docker Compose đã build/chạy; health endpoint trả `ok`, example seed có 1 study, 5 series, 284 slices. Compose bind app vào loopback VM `127.0.0.1:8080`, không public.
- Máy phát triển mở SSH tunnel qua IAP từ local port `8081` tới VM `127.0.0.1:8080`; truy cập `http://127.0.0.1:8081` khi tunnel còn chạy.
- Cloud SQL/PostgreSQL: hoãn; staging một VM vẫn dùng SQLite trong named volume `knee_data`. Chưa có Cloud SQL instance.

Trạng thái trên là ghi chú tiến độ theo những gì người dùng báo/gửi từ Console, không phải kiểm tra trực tiếp qua Google Cloud API. Budget alerts thông thường chỉ cảnh báo, không tự dừng resource/chi phí.

| Từ khóa | Ý nghĩa | Vai trò hiện tại |
|---|---|---|
| Project | Vùng quản lý tài nguyên, quyền, API, quota và billing. | `rsna-knee-511004` cho staging. |
| Billing account | Tài khoản thanh toán được liên kết với project. | Xác nhận trước khi tạo VM/disk/network. |
| Region / zone | Khu vực địa lý / một vùng triển khai cụ thể trong region. | Chọn gần người dùng và phù hợp availability/quota; VM nằm trong một zone. |
| IAM | Quy định principal nào được làm hành động gì trên resource. | Cấp quyền quản trị tối thiểu; dùng IAP giới hạn người vào staging. |
| API enablement | Bật API sản phẩm trên project trước khi dùng một số dịch vụ. | Chỉ bật API cần cho bước triển khai, như Compute Engine/IAP. |
| Quota | Hạn mức tài nguyên/API của project hoặc region. | GPU có quota riêng; giai đoạn viewer CPU chưa cần GPU quota. |

## `gcloud` login và ADC

Đây là hai credentials/context khác nhau:

| Cấu hình | Dùng bởi | Lệnh đăng nhập |
|---|---|---|
| Google Cloud CLI credentials | Các lệnh `gcloud`, ví dụ set project hoặc quản lý VM. | `gcloud auth login` |
| Application Default Credentials (ADC) | Google client libraries trong code local và thường là Terraform Google provider. | `gcloud auth application-default login` |

Project mặc định của CLI:

```cmd
gcloud config set project rsna-knee-511004
gcloud config list
```

Nếu warning báo ADC quota project khác, đó là project được dùng cho quota/billing của một số client-based API; nó không tự có nghĩa CLI project sai. Khi dùng ADC cho project này, sau khi đã tạo ADC, đồng bộ quota project:

```cmd
gcloud auth application-default set-quota-project rsna-knee-511004
```

Lệnh trên cần quyền `serviceusage.services.use`. Không copy/paste token, credential JSON hoặc nội dung ADC file vào chat/Git. Với workload đã chạy trong GCP, ưu tiên service account gắn vào workload thay vì mang credential người dùng lên VM.

## Các dịch vụ liên quan

### Compute Engine VM

Là máy Linux ảo. Staging đầu tiên dùng một VM CPU chạy Docker Compose để giữ gần nguyên app hiện tại. VM là single point of failure, phù hợp demo nội bộ chứ không phải production.

### Disk và Docker volume

Compose hiện lưu SQLite và DICOM trong named volume. Container có thể được build/recreate mà volume vẫn giữ dữ liệu; nhưng dữ liệu cần được backup và thử restore. Trên GCP, đặt volume trên boot Persistent Disk hoặc data Persistent Disk; không chọn Local SSD cho dữ liệu cần giữ qua stop/restart.

### VPC, firewall và IAP

VPC là mạng riêng của project; firewall rules quyết định traffic nào được tới VM. IAP TCP forwarding cho phép người được cấp IAM tạo tunnel tới VM, kể cả VM không có external IP. Web app hiện bind loopback `8080`, vì vậy dùng SSH local port-forward qua IAP; không mở port 8080 công khai. VM không có external IP vẫn cần outbound egress (ví dụ Cloud NAT) để tải package/source; nếu chọn phương án external IP cho egress, phải khóa inbound bằng firewall và không public web.

### Cloud NAT

Cloud NAT là dịch vụ NAT outbound theo VPC và region. Với Public NAT, VM không có external IPv4 vẫn có thể mở kết nối đi ra internet (ví dụ `apt`, tải Docker image hoặc lấy source); các gói trả lời cho những kết nối outbound đó được NAT đưa về VM. NAT **không** cấp public IP trực tiếp cho VM và không cho internet tự khởi tạo kết nối vào VM; việc SSH quản trị vẫn đi qua IAP/firewall. Cloud NAT cần Cloud Router cùng VPC và region, nhưng router không phải máy ảo và không chạy ứng dụng.

Cloud NAT có thể phát sinh phí gateway theo số VM sử dụng, dữ liệu xử lý, IP NAT và lưu lượng truyền ra ngoài; budget alert không tự dừng các khoản phí. Kiểm tra bảng giá hiện hành trước khi tăng tải. Tham khảo [Cloud NAT overview](https://docs.cloud.google.com/nat/docs/overview), [thiết lập Public NAT](https://docs.cloud.google.com/nat/docs/set-up-manage-network-address-translation) và [pricing](https://cloud.google.com/nat/pricing).

### Cloud Storage (GCS)

Object storage cho file DICOM, preview, artifacts hoặc model checkpoints. Không phải database, không tự chạy inference. Đây là đích phù hợp khi sau này tách storage khỏi disk của VM.

### Cloud SQL

Managed relational database; có thể thay SQLite khi app cần nhiều instance hoặc backend managed runtime. Chuyển sang Cloud SQL là migration dữ liệu/schema, không chỉ đổi connection string.

### Identity Platform

Dịch vụ xác thực danh tính: quản lý credential/sign-in (ví dụ email/password), reset password và ID token. Không lưu study/series thay PostgreSQL và không tự quyết định user có quyền đọc study nào; FastAPI phải xác minh token rồi enforce ownership. Xem [Identity Platform authentication](https://docs.cloud.google.com/identity-platform/docs/concepts-authentication) và [plan tài khoản](18-auth-and-user-data-plan.md).

### Cloud Run

Managed runtime chạy container services/jobs mà không cần tự vận hành VM/cluster. Hợp với FastAPI stateless và worker/job sau khi app dùng persistent storage/database bên ngoài. Không deploy nguyên trạng app SQLite/local-filesystem lên nhiều instance Cloud Run.

### Artifact Registry

Nơi lưu Docker images có version/tag, ví dụ theo commit SHA. Khi chuyển từ build image trên VM sang pipeline chuẩn, CI build/test image, push vào Artifact Registry, rồi staging deploy đúng image bất biến.

### Terraform

Infrastructure as Code: khai báo project resources như VM, disk, firewall, service accounts, bucket và database trong `.tf` files. Vòng lặp là viết → `terraform plan` xem diff → review → `terraform apply`. Terraform không chứa uploads/checkpoints và không thay CI.

Lần đầu có thể tạo staging thủ công để hiểu các resource/setting; sau đó viết Terraform để tái tạo. Từ lúc một resource được Terraform quản lý, tránh chỉnh cùng resource bằng Console mà không cập nhật code/state.

### Triton, GPU và Kubernetes/GKE

- **GPU** là phần cứng cloud cấp cho workload; GPU có quota/region/chi phí riêng.
- **Triton** là inference server load model repository và phục vụ inference; nó không cấp GPU.
- **Kubernetes** điều phối container/replicas. **GKE** là Kubernetes được Google quản lý.
- Không cần Kubernetes chỉ vì app dùng Docker hoặc Triton. Đầu tiên thử Triton trong container trên một GPU runtime/VM; cân nhắc GKE khi cần điều phối nhiều GPU/replica hoặc vận hành phức tạp.

VM staging `knee-review-staging-01` là `e2-medium` CPU-only, chưa có GPU. GPU không tự được cấp cho VM; cần machine configuration hỗ trợ, zone/quota còn capacity và chi phí riêng. Khi model sẵn sàng, ưu tiên GPU VM riêng chạy Triton để tách chi phí; API staging gọi qua private network. Xem [GPU add/remove](https://docs.cloud.google.com/compute/docs/gpus/add-remove-gpus) và [GPU pricing](https://cloud.google.com/products/compute/gpus-pricing?hl=en).

## Lộ trình deploy của dự án

```text
Đã có: local Compose + staging v0 trên Compute Engine CPU VM / Docker Compose / IAP tunnel
    → trước khi mời multi-user: Identity Platform + FastAPI token verification + owner_uid authorization
    → khi cần nhiều backend instances: Cloud Storage + Cloud SQL + stateless FastAPI/worker trên Cloud Run
    → khi model sẵn sàng: GPU VM riêng + Triton, API/worker gọi qua private network
    → chỉ khi cần orchestration: Kubernetes trên GKE
```

Terraform có thể mã hóa hạ tầng sau khi staging v0 được thử; nó không phải tầng chạy app và không phải điều kiện trước để hiểu/kiểm tra MVP.

Chi tiết triển khai theo từng bước nằm ở [09 — GCP runbook](09-gcp-runbook.md), còn kiến trúc local hiện hành ở [04 — Architecture](04-architecture-data.md).

## Bước hiện tại

1. Đã xong theo xác nhận người dùng: project `rsna-knee-511004`, billing liên kết, budget alert đã tạo.
2. Đã xong theo xác nhận người dùng: VM `knee-review-staging-01` đang chạy ở `asia-southeast1-a`, không external IPv4; IAP/firewall/tag khớp và SSH tunnel hoạt động.
3. Đã xong theo xác nhận người dùng: tạo Public Cloud NAT `knee-review-nat` cùng Cloud Router `knee-review-router` trong VPC `default`, region `asia-southeast1`, IPv4, NAT IP tự động, Standard tier.
4. Đã xong theo kiểm tra: outbound, Docker/Compose, clone `dev`, chuyển sample, chạy Compose và gọi health endpoint. Tiếp theo là kiểm thử giao diện qua IAP tunnel và thao tác persistence an toàn.
5. Cloud SQL để sau khi cần nhiều backend instance/DB managed; cần migration từ SQLite trước khi tạo kết nối production. Cloud SQL có phí compute/storage/backup.
6. VM hiện tại không có GPU. Chưa tạo GPU VM/quota; chờ model/preprocessing benchmark rồi quyết định GPU, zone và ngân sách.

Các trạng thái provisioning (VM/NAT/IAM) ở trên dựa theo thông tin Console do người dùng cung cấp; Docker, clone source, checksum, app health và seed đã được kiểm tra từ VM trong phiên làm việc. Không lưu số thẻ hoặc thông tin thanh toán vào tài liệu.
