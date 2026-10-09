# 09 — Deploy staging GCP và lộ trình Triton

> **Cập nhật gần nhất:** 2026-10-08
> **Thay đổi gần nhất:** Ghi nhận VM staging hiện là CPU-only; thêm lộ trình đăng nhập qua Identity Platform, ownership authorization, PostgreSQL/GCS và GPU VM riêng cho Triton.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Quyết định cho lần deploy đầu

Deploy **một staging riêng tư, chưa có AI**, bằng một Compute Engine VM chạy Docker Compose. Đây là cách ít thay đổi app nhất vì phiên bản hiện tại ghi SQLite và DICOM vào filesystem/volume Docker, đồng thời seed example từ thư mục mount. Một VM với disk bền vững giữ nguyên mô hình đó; Cloud Run không nên nhận image hiện tại nguyên trạng vì filesystem của instance là tạm thời và không chia sẻ được như volume local.

Staging ban đầu không cần public IP cho VM hoặc web app public. Dùng IAP/SSH tunnel để người được cấp quyền mở app trên `localhost`; đây là kiểm soát ở hạ tầng, không thêm tài khoản/mật khẩu vào giao diện sản phẩm. Không đưa dữ liệu bệnh nhân thật lên staging này; chỉ dùng sample đã được kiểm tra de-identification.

### Bản đồ vai trò

| Thành phần | Dùng để làm gì ở dự án này? | Khi nào? |
|---|---|---|
| GCP | Nhà cung cấp cloud: VM/disk, Cloud Storage, database, registry, mạng và GPU. | Ngay cho staging. |
| Compute Engine | Một Linux VM chạy Docker Compose, gồm app hiện tại. | Staging đầu tiên, giữ SQLite/local files. |
| Terraform | Khai báo hạ tầng GCP dưới dạng code; review `plan`, rồi `apply`. Không chứa DICOM hoặc checkpoint. | Sau khi thử tay một lần và chốt cấu hình. |
| Triton | Inference server nạp model repository và nhận request inference từ backend/worker. | Chỉ khi model/preprocessing contract đã có. |
| GPU | Phần cứng tính toán được cấp cho VM/runtime. Triton không tạo hoặc thuê GPU. | Cùng lúc bắt đầu benchmark inference. |
| Kubernetes / GKE | Điều phối nhiều container, replicas, autoscaling và rollout. | Chỉ khi có nhu cầu vận hành mà một service/VM đơn không đáp ứng. |

Terraform workflow: viết cấu hình → `terraform plan` để xem thay đổi → `terraform apply` để tạo/cập nhật hạ tầng. Nên lưu state ở backend dùng chung và không commit secrets/state nhạy cảm. Lúc đầu có thể tạo project/VM thủ công để học luồng; sau đó mã hóa thành Terraform, tránh vừa click console vừa để Terraform quản lý cùng một resource.

## Staging v0: VM + Docker Compose

### Điều kiện trước khi tạo tài nguyên

1. Có GCP project riêng cho thử nghiệm và billing được bật; đặt budget alert, nhớ alert không phải hard spending cap.
2. Chọn một commit đã được review/merge theo branch workflow; không deploy working tree có dữ liệu hoặc thay đổi chưa review.
3. Kiểm tra sample DICOM, dung lượng ZIP và de-identification; không đưa `dicom-viewer/files` hoặc dữ liệu nghiên cứu vào Git/image.
4. Cài Google Cloud CLI và xác thực trên máy cá nhân; xác nhận có quyền tạo Compute Engine VM, firewall/IAP và disk.

### Các bước triển khai

**Trạng thái thực tế 2026-10-08:** VM `knee-review-staging-01` đang chạy tại `asia-southeast1-a`, không external IPv4; tag/firewall và IAP SSH đã được người dùng xác nhận. Public Cloud NAT `knee-review-nat` / router `knee-review-router` ở VPC `default`, `asia-southeast1`, IPv4, Automatic IP, Standard tier đã được tạo theo xác nhận người dùng. Outbound được xác minh qua `apt-get update` và tải image Docker Hub. Docker/Compose đã cài. Nhánh `dev` được clone ở `/home/nguyenloc/knee-review` tại commit `8f8d805`; `results.zip` đã chuyển vào thư mục example với SHA-256 khớp. Compose đã build và chạy, API health `ok`, một example study với 5 series/284 slices đã seed. Web bind loopback VM `127.0.0.1:8080`; tunnel local IAP đang forward từ `127.0.0.1:8081`. Cloud SQL chưa tạo; SQLite vẫn nằm trong named volume `knee_data`.

1. Tạo VM Linux nhỏ phù hợp cho demo CPU, không gắn GPU; ưu tiên không external IP và cấu hình outbound egress (ví dụ Cloud NAT) để cài Docker/checkout source. Nếu dùng external IP cho egress, vẫn khóa ingress bằng firewall và không mở 8080/SSH công khai.
2. Gắn network tag riêng cho VM, ví dụ `knee-review-staging`; bật IAP API; tạo ingress rule chỉ cho IAP TCP forwarding tới SSH (`tcp:22`, nguồn `35.235.240.0/20`) nhắm đúng tag. Không mở cổng 8080 ra internet. Kiểm tra/gỡ rule SSH mặc định mở rộng nếu có.
3. Dùng boot Persistent Disk hoặc data Persistent Disk; không dùng Local SSD cho SQLite/uploads. Giữ disk khi xóa VM và thiết lập snapshot/backup trước khi có dữ liệu cần giữ.
4. Cài Docker Engine và Compose plugin trên VM; checkout đúng commit; chuyển example ZIP qua kênh quản trị an toàn vào thư mục seed bên ngoài image.
5. Chạy Compose, kiểm tra `/api/health`, upload study thử, mở Overview/MPR, xóa study upload và xác nhận example read-only.
6. Cấp IAM IAP tunnel và OS Login phù hợp, rồi mở SSH local port-forward qua IAP từ máy cá nhân tới loopback `localhost:8080` trên VM; truy cập `http://localhost:8080`. Chỉ người được cấp IAM mới tạo được tunnel.
7. Kiểm tra restart VM/container và xác nhận data còn; kiểm tra log, dung lượng disk và backup/restore sample trước khi cho người khác dùng.

Compose hiện publish app vào loopback của VM; vì vậy không nên thêm firewall 8080 để public. IAP TCP forwarding có thể bảo vệ SSH/tunnel mà không cần external IP; bảo vệ tunnel không tự làm app an toàn cho dữ liệu lâm sàng. Nguồn: [IAP TCP forwarding](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding), [Persistent Disk](https://docs.cloud.google.com/compute/docs/disks/persistent-disks?hl=en).

**Cloud NAT là gì trong luồng này?** Public NAT cho VM không external IPv4 tạo kết nối outbound và nhận traffic trả lời của kết nối đó; nó không mở inbound SSH/web. Cấu hình NAT theo VPC và region, dùng Cloud Router cùng region. Gateway, IP NAT, dữ liệu xử lý và egress có thể tính phí. Outbound của staging đã được kiểm tra bằng cập nhật apt và Docker image pull. Nguồn: [Cloud NAT overview](https://docs.cloud.google.com/nat/docs/overview), [pricing](https://cloud.google.com/nat/pricing).

### Kiểm thử truy cập hiện tại

Giữ SSH tunnel chạy trên máy local, forward port local `8081` tới loopback VM `8080`, rồi mở `http://127.0.0.1:8081`. Tunnel do phiên SSH tạo ra; nếu đóng terminal/process thì cần mở lại. Không thêm firewall ingress cho `8080`.

Example `results.zip` nằm ở host path `/home/nguyenloc/knee-review/dicom-viewer/files/results.zip`, được mount read-only vào `/examples`; seeder giải nén DICOM vào `/app/data/studies/sample-archive` trong named volume. Upload study thường cũng được giữ trong volume `knee_data`. `docker compose down` không xóa named volume; tránh `docker compose down -v`, xóa volume, hoặc xóa boot disk nếu còn cần dữ liệu.

### Cân nhắc Cloud SQL/PostgreSQL

Không tạo Cloud SQL chỉ để lưu dữ liệu cho staging một VM: app hiện dùng SQLite và Compose named volume đã đủ cho demo đơn máy. Cloud SQL là dịch vụ managed riêng, có phí compute, storage, backup và networking; HA làm tăng chi phí. Chỉ chuyển khi cần nhiều backend instance dùng chung DB, managed backup/restore hoặc PostgreSQL cho môi trường cao hơn. Migration đòi hỏi thay persistence SQLite bằng PostgreSQL driver/schema migrations; không chỉ tạo instance rồi đổi URL. DICOM files nên chuyển sang object storage như Cloud Storage, còn database lưu metadata/object keys. Nguồn: [Cloud SQL pricing](https://cloud.google.com/sql/pricing/), [Cloud SQL PostgreSQL backups](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/backups).

### Giới hạn staging này

- Một VM là điểm lỗi đơn; phù hợp demo nội bộ, không phải deployment HA/production.
- SQLite và uploads chỉ trên một host; cần snapshot/backup và quy trình restore được thử nghiệm.
- Hiện chưa có app login/ownership; chỉ dùng staging riêng tư qua IAP với người được cấp quyền hạ tầng. Người dùng ứng dụng cùng thấy chung catalog và có thể thao tác study upload; không public endpoint, không mời người dùng khác và không dùng dữ liệu định danh.
- Example mount phải được đưa lên VM riêng, không đóng gói trong image; cần kiểm tra license/provenance và dung lượng.
- Dependency audit hiện còn advisory; chưa tuyên bố production/clinical-ready.

## Lộ trình tài khoản và dữ liệu nhiều người dùng

Quyết định đề xuất: dùng **Google Identity Platform email/password** để quản lý credential và token; FastAPI xác minh token và enforce ownership trên từng endpoint. PostgreSQL/Cloud SQL là nơi lưu metadata/profile/`owner_uid`, không lưu password. Tài khoản được tạo qua invite/admin ở giai đoạn đầu; không bật public signup. Mỗi study upload thuộc một Identity UID; mọi list/read/preview/raw-file/delete đều authorize ở backend. Example study vẫn shared read-only.

Thứ tự khuyến nghị:

1. Giữ staging sau IAP và chỉ dùng sample; thiết kế roles, account provisioning, retention/delete, audit và upload quota.
2. Tích hợp Identity Platform ở frontend; gửi ID token tới FastAPI; xác minh issuer/audience/expiry ở server.
3. Thêm `owner_uid` và authorization vào mọi endpoint; viết tests anonymous/expired token và cross-user access trước khi mở cho người khác.
4. Có thể thử trên SQLite một VM bằng migration có backup; chuyển PostgreSQL/Cloud SQL khi cần nhiều API replicas/managed DB. Không tự lưu password trong SQL.
5. Tách DICOM sang private Cloud Storage và giữ metadata/object keys trong DB khi mở rộng.

Chi tiết, hai tuần triển khai và acceptance gate nằm ở [18 — Auth and user data plan](18-auth-and-user-data-plan.md). Identity Platform xử lý authentication, không tự enforce quyền truy cập các study trong app.

## GPU: không nằm trong VM staging hiện tại

VM staging hiện tại là `e2-medium`, không có GPU; nó chỉ chạy Docker Compose cho viewer/API CPU. GPU cần cấu hình/VM family/zone/quota phù hợp và tính phí riêng. Một số VM có thể thêm accelerator sau khi stop/đổi cấu hình, nhưng không giả định e2 shared-core gắn GPU trực tiếp được. Khi checkpoint/preprocessing sẵn sàng, ưu tiên prototype trên GPU VM riêng chạy Triton, API gọi qua private network; chỉ bật VM khi benchmark/inference. Chưa tạo GPU VM hoặc quota request ở giai đoạn viewer. Xem [GPU add/remove](https://docs.cloud.google.com/compute/docs/gpus/add-remove-gpus), [GPU pricing](https://cloud.google.com/products/compute/gpus-pricing?hl=en) và [18](18-auth-and-user-data-plan.md).

## Sau staging: tách storage để chạy managed services

Khi muốn deploy frontend/backend riêng và scale nhiều instance, chuyển raw DICOM và preview sang Cloud Storage; chuyển catalog/metadata từ SQLite sang PostgreSQL managed; tách background ingest thành job/worker; thêm auth ở ranh giới mạng hoặc identity nếu cho truy cập ngoài nhóm nhỏ. Khi đó React có thể host tĩnh, FastAPI chạy Cloud Run CPU. Không chuyển nguyên SQLite/local-volume app lên Cloud Run: Cloud Run instance filesystem disposable, file cần tồn tại phải lưu dịch vụ ngoài hoặc mounted persistent storage.

Cloud Run là hướng thử trước GKE cho HTTP services/jobs đơn giản. Cloud Run cũng hỗ trợ GPU hiện hành, nhưng cần prototype với model thật, cold start, memory/VRAM, request/job duration và chi phí trước khi chọn. Nguồn: [Cloud Run overview](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run), [Cloud Run GPU](https://docs.cloud.google.com/run/docs/configuring/services/gpu?hl=en).

## Triton/GPU: phase model serving

Triton Inference Server có thể chạy trong Docker trên GPU VM hoặc runtime hỗ trợ GPU. GPU được cấp bởi hạ tầng cloud; Triton chỉ serve model. Model repository có thể chứa nhiều model/version và configuration; giữ tách biệt model artifacts với bucket study uploads. Backend/worker gửi tensors tới Triton qua private network; không expose Triton ports trực tiếp ra browser/public internet. Nguồn: [Triton server docs](https://github.com/triton-inference-server/server), [Triton model repository](https://github.com/triton-inference-server/server/blob/main/docs/user_guide/model_repository.md).

Trình tự trước khi bật GPU:

1. Chốt checkpoint, architecture, preprocessing, class order, score semantics theo [06](06-ai-triton-contract.md).
2. Đóng gói model repository, pin Triton/framework/CUDA; xác định API contract.
3. So sánh output local reference với Triton; đo RAM/VRAM, cold/warm latency và throughput.
4. Chọn GPU/region/quota/topology theo kết quả đo; đặt budget/quota limits.
5. Thêm async job, snapshot đầu vào, trạng thái, kết quả và UI; viewer phải hoạt động khi AI unavailable.
6. Kiểm tra readiness, timeout, OOM, restart, logs/metrics, backup và rollback.

Checkpoint `.pth` không tự trở thành service chỉ bằng cách copy file; cần runtime/code, model repository và input/output contract. Batching/concurrency chỉ bật khi model và tensor shapes hỗ trợ.

## Khi cân nhắc GKE

Chỉ chuyển Triton sang GKE nếu cần nhiều replica/GPU, scheduling/placement, scale/rollout phức tạp hoặc nhiều workload chung cluster. GKE không thay Triton; Triton vẫn là container inference chạy bên trong Pod. Kubernetes thêm trách nhiệm cluster, node pools, GPU scheduling, probes, ingress, secrets, monitoring và upgrades. Bắt đầu bằng Cloud Run GPU hoặc một GPU VM để học/benchmark; không dựng GKE chỉ vì app có Docker.

Production gate: backup/restore đã diễn tập, IAM least-privilege, private networking, retention/delete policy, audit/logging, dependency review, monitoring, rollback và dữ liệu đã có quy trình de-identification/approval phù hợp. Giá, quota, GPU availability và compatibility phải kiểm tra tại thời điểm deploy.
