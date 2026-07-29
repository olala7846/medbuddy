terraform {
  required_version = "~> 1.15.0"

  backend "gcs" {
    bucket = "medbuddy-tf-state-643586490631-us-west1"
    prefix = "prototype"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }

    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = local.project_id
  region  = local.region
}

provider "google-beta" {
  project = local.project_id
  region  = local.region
}
