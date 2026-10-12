# Terraform — staging adoption, phase 1

> **Cập nhật gần nhất:** 2026-10-12
> **Thay đổi gần nhất:** Đã apply 5 imports vào remote state; CI staging chạy `fmt`/`validate`, chưa bật plan/apply trong GitHub Actions.

This directory adopts the already-created staging GCS bucket, Artifact Registry
repository, Cloud Run runtime service account, and the runtime's existing GCS /
Firestore permissions. It does not create or delete production resources.

The Terraform configuration (`.tf` files and provider lockfile) lives with the
application in `knee-web/terraform/staging`; this blueprint directory holds the
operational instructions and decision record.

The Cloud Run service/revisions remain owned by GitHub Actions CD. The Firestore
database, GitHub Workload Identity Federation/deployer, Secret Manager, Scheduler,
and Vercel settings are intentionally outside this first adoption pass. They can
be added only after this plan is clean and the ownership boundaries are agreed.

## Terraform làm gì trong dự án này?

Terraform là Infrastructure as Code: các file `.tf` mô tả cấu hình hạ tầng GCP
được quản lý. `terraform plan` so sánh cấu hình với hạ tầng/state và chỉ preview;
`terraform apply` mới ghi nhận import hoặc thực hiện thay đổi. Remote state ở GCS
là sổ ánh xạ resource Terraform với resource GCP, không phải DICOM hay Firestore.

Phase staging này chỉ adopt bucket DICOM, Artifact Registry, runtime service
account và hai IAM bindings. GitHub Actions vẫn build image, deploy Cloud Run,
smoke-test rồi promote traffic. Terraform không tự deploy frontend/backend code
và không quản lý những resource chưa khai báo trong `.tf`.

## Remote state bootstrap and safe first plan

Requirements: Terraform CLI 1.5+, `gcloud` ADC for the same project, and access to
read the existing resources. State is stored remotely in the dedicated private
GCS bucket `rsna-knee-tfstate-511004`, in region `asia-southeast1`, under prefix
`knee-web/staging`. The bucket has uniform bucket-level access, public access
prevention, seven-day soft delete, and Object Versioning enabled. It is separate
from both DICOM buckets. Do not add a lifecycle rule that deletes Terraform state.

The backend is declared in `knee-web/terraform/staging/main.tf`; the backend
configuration uses literal values because Terraform does not allow input
variables in a backend block. The successful `terraform init` on 2026-10-12
confirmed that the local working directory is configured to use the GCS backend.
The reviewed plan proposed 5 imports and 3 in-place changes to set
`deletion_policy = "PREVENT"` on the bucket, Artifact Registry repository, and
runtime service account, with 0 destroys. The user applied that plan; a
subsequent `terraform state list` confirmed all five expected resources are now
recorded in remote state.

The repository ignores `.terraform/`, `*.tfstate`, `*.tfstate.*`, `*.tfplan`,
and `*.tfvars*`; keep `.terraform.lock.hcl` tracked. Ignoring local state files
does not affect the remote GCS state.

```powershell
gcloud config set project rsna-knee-511004
gcloud auth application-default login
Set-Location knee-web/terraform/staging # from repository root
# Or, if already in knee-web: Set-Location .\terraform\staging
terraform init
terraform fmt
terraform fmt -check
terraform validate
terraform plan -out=staging-protected.tfplan
terraform show staging-protected.tfplan
```

The applied plan imported **5 resources** and changed only the three deletion
guards in place; it did not add or destroy infrastructure. The HCL sets
`deletion_policy = "PREVENT"` on the DICOM bucket, Artifact Registry
repository, and runtime service account. This guards against accidental
Terraform deletion; it does not prevent edits outside Terraform.

`terraform plan` previews the named existing-resource imports and reports any
configuration drift; it does not write the imports to state or change GCP.
Terraform records imported resources in remote state only if a reviewed plan is
later applied. **Do not run `terraform apply` just to make the import happen.**
First inspect the plan for changes to
bucket CORS, lifecycle, retention, IAM, replacement, or deletion. If the plan
proposes changes that are not intended, stop and reconcile the HCL with the
current GCP configuration before considering apply. Never apply a plan that
destroys/replaces the staging bucket or Firestore data.

Before any future apply, review the saved plan and verify it contains no
unexpected add/change/destroy actions. State access must remain restricted to
the operator and any explicitly authorized Terraform CI identity. Do not use
the DICOM bucket for state.

## Terraform CI status

The repository CI runs `terraform fmt -check -recursive`, initializes the
provider with `-backend=false`, and runs `terraform validate` for this staging
configuration. It needs no GCP credentials, does not access remote state, and
cannot change GCP. A Terraform CI failure blocks the Cloud Run deploy job.

GitHub Actions does **not** yet run `terraform plan` or `terraform apply`.
Remote plan requires a separate least-privilege WIF identity with permission to
read/lock the state object and read each managed GCP resource. The current
staging deployer identity is for Cloud Run CD; do not broaden its permissions
without an explicit IAM review. Until that identity and IAM are set up, run
`terraform plan` locally after `terraform init` and inspect the result. Never
configure CI to auto-apply on every push; apply only after reviewing the plan.

## Explicit ownership boundaries

- GitHub Actions owns Cloud Run image rollout, candidate revision, health check,
  and traffic promotion/rollback.
- Terraform phase 1 owns the existing staging storage/image/runtime foundation.
- Production, GPU VM/Triton, data seed contents, and app secrets are not managed
  here.
- The default allowed bucket CORS origins mirror the observed staging bucket at
  adoption time; verify them against current Vercel domains before changing them.
