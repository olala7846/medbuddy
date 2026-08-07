resource "google_firestore_database" "default" {
  project                           = local.project_id
  name                              = "(default)"
  location_id                       = local.region
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "OPTIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "ABANDON"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"

  depends_on = [google_project_service.required["firestore.googleapis.com"]]

  lifecycle {
    prevent_destroy = true
  }
}

# scanCurrent is bounded by limit(500), but its acceptedAt/recordedAt/id total
# order requires explicit indexes in both supported timestamp directions.
resource "google_firestore_index" "dynamic_memory_newest" {
  project     = local.project_id
  database    = google_firestore_database.default.name
  collection  = "dynamicMemoryRecords"
  query_scope = "COLLECTION"

  fields {
    field_path = "canonicalSource.acceptedAt"
    order      = "DESCENDING"
  }

  fields {
    field_path = "recordedAt"
    order      = "DESCENDING"
  }

  fields {
    field_path = "__name__"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "dynamic_memory_oldest" {
  project     = local.project_id
  database    = google_firestore_database.default.name
  collection  = "dynamicMemoryRecords"
  query_scope = "COLLECTION"

  fields {
    field_path = "canonicalSource.acceptedAt"
    order      = "ASCENDING"
  }

  fields {
    field_path = "recordedAt"
    order      = "ASCENDING"
  }

  fields {
    field_path = "__name__"
    order      = "ASCENDING"
  }
}

resource "google_storage_bucket" "attachments" {
  name                        = local.attachment_bucket_name
  project                     = local.project_id
  location                    = local.region
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = false
  }

  depends_on = [google_project_service.required["storage.googleapis.com"]]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_cloud_tasks_queue" "capture" {
  project  = local.project_id
  location = local.region
  name     = local.capture_queue_name

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 10
  }

  retry_config {
    max_attempts  = 3
    min_backoff   = "5s"
    max_backoff   = "3600s"
    max_doublings = 5
  }

  depends_on = [google_project_service.required["cloudtasks.googleapis.com"]]
}
