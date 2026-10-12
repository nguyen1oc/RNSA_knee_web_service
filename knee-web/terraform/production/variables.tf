variable "project_id" {
  description = "GCP project containing the existing production resources."
  type        = string
  default     = "rsna-knee-511004"
}

variable "region" {
  description = "GCP region for the production bucket."
  type        = string
  default     = "asia-southeast1"
}

variable "dicom_bucket" {
  description = "Existing private production bucket; Terraform must never delete its contents."
  type        = string
  default     = "rsna-knee-dicom-production-511004"
}

variable "bucket_cors_origins" {
  description = "Production Vercel origin allowed for direct GCS uploads."
  type        = list(string)
  default     = ["https://rnsa-knee-web-service.vercel.app"]
}

variable "runtime_service_account_id" {
  description = "Existing production Cloud Run runtime service account ID."
  type        = string
  default     = "knee-review-api-production"
}

variable "firestore_database" {
  description = "Existing production Firestore database name used in the IAM condition."
  type        = string
  default     = "knee-review-production"
}
