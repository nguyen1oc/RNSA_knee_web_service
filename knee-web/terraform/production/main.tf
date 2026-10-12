terraform {
  backend "gcs" {
    bucket = "rsna-knee-tfstate-511004"
    prefix = "knee-web/production"
  }

  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0, < 9.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Adopt existing production resources. Keep the DICOM bucket protected from
# accidental deletion; Cloud Run and the Firestore database remain separately
# managed until their ownership/deletion safeguards are reviewed.
resource "google_storage_bucket" "production_dicom" {
  name                        = var.dicom_bucket
  project                     = var.project_id
  location                    = upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  deletion_policy             = "PREVENT"
  force_destroy               = false

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  cors {
    origin          = var.bucket_cors_origins
    method          = ["PUT", "POST"]
    response_header = ["Content-Type", "Content-Range", "Range", "x-goog-resumable"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age            = 1
      matches_prefix = ["incoming/"]
    }
  }
}

resource "google_service_account" "runtime" {
  project         = var.project_id
  account_id      = var.runtime_service_account_id
  display_name    = "Knee Review Production Cloud Run API"
  deletion_policy = "PREVENT"
}

resource "google_storage_bucket_iam_member" "runtime_object_admin" {
  bucket = google_storage_bucket.production_dicom.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"

  condition {
    title       = "production_firestore_only"
    description = "Production database only"
    expression  = "resource.name=='projects/${var.project_id}/databases/${var.firestore_database}'"
  }
}
