# Terraform 1.5+ plan-time imports. The first plan should show imports and
# may show proposed drift corrections. Review every proposed change; do not
# apply until it is understood and the plan contains no destructive actions.
import {
  id = "${var.project_id}/${var.dicom_bucket}"
  to = google_storage_bucket.staging_dicom
}

import {
  id = "projects/${var.project_id}/locations/${var.region}/repositories/${var.artifact_repository_id}"
  to = google_artifact_registry_repository.api_images
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
  id = "${var.project_id} roles/datastore.user serviceAccount:${var.runtime_service_account_id}@${var.project_id}.iam.gserviceaccount.com staging_default_database_only"
  to = google_project_iam_member.runtime_firestore_user
}
