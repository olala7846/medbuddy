locals {
  project_id = "med-buddy-503802"
  region     = "us-west1"

  attachment_bucket_name = "medbuddy-prototype-attachments-643586490631-us-west1"
  capture_queue_name     = "medbuddy-capture"
  runtime_account_id     = "medbuddy-runtime"
  tasks_invoker_id       = "medbuddy-tasks-invoker"

  required_services = toset([
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "firestore.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])
}
