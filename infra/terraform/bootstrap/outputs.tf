output "state_bucket_name" {
  description = "Name of the private, versioned GCS bucket used by Terraform remote state."
  value       = google_storage_bucket.terraform_state.name
}
