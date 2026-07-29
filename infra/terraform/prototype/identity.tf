resource "google_service_account" "runtime" {
  project      = local.project_id
  account_id   = local.runtime_account_id
  display_name = "MedBuddy prototype runtime"

  depends_on = [google_project_service.required["iamcredentials.googleapis.com"]]
}

resource "google_service_account" "tasks_invoker" {
  project      = local.project_id
  account_id   = local.tasks_invoker_id
  display_name = "MedBuddy Cloud Tasks callback invoker"

  depends_on = [google_project_service.required["iamcredentials.googleapis.com"]]
}

# This beta resource ensures the Cloud Tasks service identity exists before its
# callback-token authorization is granted. The stable Google provider does not
# yet expose this resource.
resource "google_project_service_identity" "cloud_tasks" {
  provider = google-beta
  project  = local.project_id
  service  = "cloudtasks.googleapis.com"

  depends_on = [google_project_service.required["cloudtasks.googleapis.com"]]
}

resource "google_project_iam_member" "runtime_firestore" {
  project = local.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_storage_bucket_iam_member" "runtime_attachments" {
  bucket = google_storage_bucket.attachments.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_tasks_queue_iam_member" "runtime_enqueuer" {
  project  = local.project_id
  location = google_cloud_tasks_queue.capture.location
  name     = google_cloud_tasks_queue.capture.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_service_account_iam_member" "cloud_tasks_service_account_user" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_project_service_identity.cloud_tasks.member

  depends_on = [google_project_service_identity.cloud_tasks]
}
