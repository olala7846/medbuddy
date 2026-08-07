locals {
  memory_formation_policy_versions = {
    production         = "memory-formation-v1"
    verification-small = "memory-formation-v1-verification-small"
  }
}

resource "google_cloud_scheduler_job" "memory_formation_recovery" {
  for_each = var.memory_formation_callback_url == null ? {} : local.memory_formation_policy_versions

  project          = local.project_id
  region           = local.region
  name             = "medbuddy-memory-formation-recovery-${each.key}"
  description      = "Bounded content-free recovery for passive memory formation"
  schedule         = "*/5 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "180s"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "5s"
    max_backoff_duration = "60s"
    max_doublings        = 3
  }

  http_target {
    uri         = var.memory_formation_callback_url
    http_method = "POST"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode(jsonencode({
      kind          = "RECOVERY"
      policyVersion = each.value
    }))

    oidc_token {
      service_account_email = google_service_account.tasks_invoker.email
      audience              = var.memory_formation_callback_url
    }
  }

  depends_on = [google_project_service.required["cloudscheduler.googleapis.com"]]
}
