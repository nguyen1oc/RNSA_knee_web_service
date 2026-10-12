# Terraform staging — phạm vi và cách vận hành

> **Cập nhật:** 13/10/2026. Terraform staging đã quản lý 5 resource. CI chỉ kiểm tra định dạng và cấu hình; CI chưa chạy `plan` hoặc `apply`.
> Trang này hướng dẫn Terraform staging. Không dùng nó để thay đổi production.
> Workflow trên `origin/dev` kiểm tra cấu hình trong thư mục staging; workflow trên `origin/main` kiểm tra cấu hình riêng trong `knee-web/terraform/production`. Checkout local đang mở có thể chưa chứa cấu hình production mới nhất.

## Terraform đang quản lý gì?

Terraform giữ cấu hình hạ tầng trong các file `.tf`. Lệnh `terraform plan` so sánh cấu hình với resource/state và cho xem thay đổi dự kiến. Lệnh `terraform apply` mới ghi thay đổi vào GCP.

Trong staging, Terraform đang quản lý:

1. Bucket DICOM staging.
2. Artifact Registry repository chứa image.
3. Runtime service account của API.
4. Quyền đọc/ghi object trên bucket staging.
5. Quyền truy cập Firestore staging.

Cloud Run revisions và traffic rollout do GitHub Actions quản lý. Terraform không build/deploy application image, không quản lý dữ liệu DICOM, checkpoint, secret, Vercel settings hoặc GitHub WIF trong giai đoạn này.

Các file cấu hình nằm trong `knee-web/terraform/staging/`. Tài liệu hướng dẫn nằm ở đây trong `knee-service-blueprint/`.

## Remote state là gì?

Terraform dùng state để nhớ resource GCP nào tương ứng với từng khai báo trong file `.tf`. State của staging được lưu riêng trong bucket `gs://rsna-knee-tfstate-511004`, dưới prefix `knee-web/staging`.

Bucket state bật private access, versioning và soft delete. Không đặt lifecycle rule để tự xóa Terraform state. Không đưa file state hoặc `*.tfplan` lên GitHub; `.gitignore` cần bỏ qua chúng. Giữ file `.terraform.lock.hcl` trong Git để CI và máy phát triển cài cùng phiên bản provider.

## Điều kiện trước khi chạy

- Cài Terraform CLI 1.5 trở lên.
- Đăng nhập Google Cloud CLI bằng đúng tài khoản.
- Đặt project là `rsna-knee-511004`.
- Đăng nhập Application Default Credentials (ADC) nếu Terraform cần quyền đọc GCP.
- Chạy lệnh trong thư mục `knee-web/terraform/staging`.

## Lần khởi tạo và kiểm tra

Từ thư mục gốc của repository, chạy:

```powershell
gcloud config set project rsna-knee-511004
gcloud auth application-default login
Set-Location knee-web/terraform/staging
terraform init
terraform fmt -check
terraform validate
terraform plan -out=staging.tfplan
terraform show staging.tfplan
```

`terraform init` cài provider và kết nối remote state. `fmt -check` kiểm tra cách viết file; `validate` kiểm tra cấu hình có hợp lệ không. Hai lệnh này không thay đổi GCP.

`plan` tạo bản xem trước. Đọc toàn bộ kết quả `terraform show` trước khi quyết định. Nếu plan muốn xóa/thay bucket, thay IAM ngoài dự kiến hoặc thay dữ liệu, dừng lại và điều tra; không chạy apply.

## Đã áp dụng staging

Resource đã được import vào remote state. Một plan đã được review và apply để bảo vệ bucket, Artifact Registry repository và runtime service account khỏi bị Terraform xóa ngoài ý muốn bằng `deletion_policy = "PREVENT"`. Không có resource nào bị tạo mới hoặc xóa trong lần apply đó. `terraform state list` xác nhận 5 resource:

```text
google_artifact_registry_repository.api_images
google_project_iam_member.runtime_firestore_user
google_service_account.runtime
google_storage_bucket.staging_dicom
google_storage_bucket_iam_member.runtime_object_admin
```

Trước mỗi lần apply sau này, hãy tạo plan mới, đọc kỹ số lượng `add/change/destroy`, rồi chỉ apply đúng plan đã xem. Không dùng `terraform apply -auto-approve` cho staging hoặc production.

## CI hiện làm gì?

GitHub Actions chạy `terraform fmt -check`, `terraform init -backend=false` và `terraform validate` cho cấu hình staging. CI không dùng GCP credentials, không đọc remote state và không thể thay đổi GCP. CI hiện không chạy `plan` hoặc `apply`.

CI không chạy Terraform production từ thư mục này. Cấu hình production nằm riêng tại `knee-web/terraform/production` trên `origin/dev` và `origin/main`; workflow kiểm tra cấu hình đó khi PR/push nhắm tới `main`. Trước khi apply production, phải dùng backend state production riêng, xem kỹ plan và thực hiện apply có kiểm soát. Không dùng quyền deploy Cloud Run làm quyền Terraform mặc định.

## Ranh giới quyền sở hữu

- Terraform quản lý 5 resource staging đã liệt kê ở trên.
- GitHub Actions build image, deploy Cloud Run candidate, chạy health check và chuyển traffic.
- GCS bucket state chỉ lưu Terraform state; không dùng nó để chứa DICOM/checkpoint.
- Nếu thay đổi resource bằng Google Cloud Console, hãy đối chiếu Terraform plan sau đó để tránh drift.

Xem [21 — tài liệu bàn giao](../../21-project-handover.md) để hiểu kiến trúc tổng thể và khác biệt giữa staging với production.
