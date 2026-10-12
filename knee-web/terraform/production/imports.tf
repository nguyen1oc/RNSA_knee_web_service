# Terraform 1.5+ plan-time imports for resources already created in GCP.
# Review the complete plan before applying; expected result is imports only,
# with no resource creation, replacement, or deletion.
import {
  id = "${var.project_id}/${var.dicom_bucket}"
  to = google_storage_bucket.production_dicom
}

import {
  id = "projects/${var.project_id}/serviceAccounts/${var.runtime_service_account_id}@${var.project_id}.iam.gserviceaccount.com"
  to = google_service_account.runtime
}

import {
  id = "b/${var.dicom_bucket} roles/storage.objectAdmin serviceAccount:${var.runtime_service_account_id}@${var.project_id}.iam.gserviceaccount.com"
  to = google_storage_bucket_iam_member.runtime_object_admin
}

import {
  id = "${var.project_id} roles/datastore.user serviceAccount:${var.runtime_service_account_id}@${var.project_id}.iam.gserviceaccount.com production_firestore_only"
  to = google_project_iam_member.runtime_firestore_user
}
