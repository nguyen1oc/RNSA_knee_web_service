variable "project_id" {
  description = "GCP project containing the existing staging resources."
  type        = string
  default     = "rsna-knee-511004"
}

variable "region" {
  description = "GCP region for the staging bucket and Artifact Registry."
  type        = string
  default     = "asia-southeast1"
}

variable "dicom_bucket" {
  description = "Existing private staging bucket; Terraform must never delete its contents."
  type        = string
  default     = "rsna-knee-dicom-preview-511004"
}

variable "bucket_cors_origins" {
  description = "Current origins allowed to upload directly to the staging GCS bucket."
  type        = list(string)
  default = [
    "https://rnsa-knee-web-service.vercel.app",
    "https://rnsa-knee-web-service-git-fe-7a5d7b-locntmasterc-5002s-projects.vercel.app",
  ]
}

variable "artifact_repository_id" {
  description = "Existing standard Artifact Registry repository for application images."
  type        = string
  default     = "knee-review"
}

variable "runtime_service_account_id" {
  description = "Existing Cloud Run runtime service account for staging."
  type        = string
  default     = "knee-review-api"
}
