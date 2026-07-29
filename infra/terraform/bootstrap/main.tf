resource "google_storage_bucket" "terraform_state" {
  name                        = "medbuddy-tf-state-643586490631-us-west1"
  location                    = "us-west1"
  force_destroy               = false
  deletion_policy             = "ABANDON"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
