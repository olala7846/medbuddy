output "project_id" {
  description = "The selected MedBuddy prototype project."
  value       = local.project_id
}

output "region" {
  description = "The selected single-region location for prototype foundation resources."
  value       = local.region
}

output "capture_queue_name" {
  description = "Cloud Tasks queue configured for canonical capture jobs."
  value       = google_cloud_tasks_queue.capture.name
}

output "attachment_bucket_name" {
  description = "Private attachment bucket name."
  value       = google_storage_bucket.attachments.name
}

output "runtime_service_account_email" {
  description = "Identity reserved for the future Cloud Run runtime."
  value       = google_service_account.runtime.email
}

output "tasks_invoker_service_account_email" {
  description = "Identity Cloud Tasks will use for callback OIDC tokens after Cloud Run exists."
  value       = google_service_account.tasks_invoker.email
}

output "capture_callback_url" {
  description = "Unset until the later Cloud Run deployment slice creates the protected callback route."
  value       = null
}
