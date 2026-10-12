# Knee Review

> **Cập nhật gần nhất:** 2026-10-12
> **Thay đổi gần nhất:** Cập nhật kiến trúc triển khai, CI/CD và hướng dẫn Terraform staging/production; cấu hình production hiện nhận import tài nguyên GCP đang chạy.
> **Lịch sử:** [knee-service-blueprint/CHANGELOG.md](knee-service-blueprint/CHANGELOG.md)

[![CI](https://github.com/nguyen1oc/RNSA_knee_web_service/actions/workflows/ci.yml/badge.svg)](https://github.com/nguyen1oc/RNSA_knee_web_service/actions/workflows/ci.yml)

Research prototype for reviewing knee MRI DICOM studies. It combines a React viewer, a FastAPI backend, native DICOM/MPR workflows, and separate staging/production deployments. It is not a clinical diagnostic device.

## Contents

- `knee-web/` — FastAPI + React service runnable with Docker.
- `knee-service-blueprint/` — product, viewer, API, QA and deployment documentation.
- `knee-web/terraform/` — Terraform configuration for GCP staging and production resources.

## Run locally

```powershell
cd knee-web
docker compose up --build -d
```

Open <http://localhost:8080>.

The viewer accepts DICOM files, folders, or ZIP archives, displays studies/series/slices, and provides geometry-aware MPR and MRI volume visualization where source data supports it. Analyze/Triton inference is not connected yet. Docker builds the React frontend in a multi-stage image; no local `dist/` folder is required. Runtime DICOM files and database data are intentionally ignored by Git.

The sample DICOM folder is local-only and is not committed. Local Docker can seed an example through the Compose `EXAMPLES_DIR` mount; Cloud Run environments use separately provisioned example data in GCS/Firestore. Users can also import their own studies.

## Environments and infrastructure

- Vercel hosts the frontend; Cloud Run hosts the API. Browser uploads send DICOM data directly to private Cloud Storage, while Firestore stores study/session metadata.
- `dev` deploys to the internal staging environment; `main` is reserved for production. GitHub Actions deploys immutable images and smoke-tests Cloud Run revisions before promoting traffic.
- Terraform staging and production configurations use separate prefixes in the private, versioned GCS state bucket. CI checks Terraform formatting and validation; it does not automatically apply infrastructure changes.
- Production Terraform adopts the existing DICOM bucket, runtime service account and IAM bindings. The production database is intentionally left unmanaged by Terraform; review a plan carefully and get human approval before applying any production changes.

See [deployment and Terraform workflow](knee-service-blueprint/15-ci-cd-plan.md) and the [GCP runbook](knee-service-blueprint/09-gcp-runbook.md) for setup, plans, apply, smoke tests and rollback guidance.
