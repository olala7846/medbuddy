TERRAFORM ?= terraform

BOOTSTRAP_DIR := infra/terraform/bootstrap
PROTOTYPE_DIR := infra/terraform/prototype

.DEFAULT_GOAL := help

.PHONY: help infra-bootstrap infra-init infra-plan infra-apply infra-output infra-verify

help:
	@printf '%s\n' 'Run make infra-bootstrap once, then use make infra-apply for future GCS-backed changes.'

# One-time setup. Creates the protected GCS backend while state is local.
infra-bootstrap:
	$(TERRAFORM) -chdir=$(BOOTSTRAP_DIR) init -input=false
	$(TERRAFORM) -chdir=$(BOOTSTRAP_DIR) fmt -check
	$(TERRAFORM) -chdir=$(BOOTSTRAP_DIR) validate
	$(TERRAFORM) -chdir=$(BOOTSTRAP_DIR) plan -out=tfplan
	$(TERRAFORM) -chdir=$(BOOTSTRAP_DIR) apply tfplan

# Initialize the GCS-backed prototype root. Safe to re-run before every apply.
infra-init:
	$(TERRAFORM) -chdir=$(PROTOTYPE_DIR) init -input=false

# Create a reviewed plan for the prototype foundation or future additions.
infra-plan: infra-init
	$(TERRAFORM) -chdir=$(PROTOTYPE_DIR) fmt -check
	$(TERRAFORM) -chdir=$(PROTOTYPE_DIR) validate
	$(TERRAFORM) -chdir=$(PROTOTYPE_DIR) plan -out=tfplan

# Normal future workflow: initialize, validate, plan, then request confirmation.
infra-apply: infra-plan
	$(TERRAFORM) -chdir=$(PROTOTYPE_DIR) apply tfplan

infra-output: infra-init
	$(TERRAFORM) -chdir=$(PROTOTYPE_DIR) output

infra-verify:
	gcloud firestore databases describe --database='(default)' --project=med-buddy-503802 --format='yaml(name,locationId,type,deleteProtectionState)'
	gcloud tasks queues describe medbuddy-capture --location=us-west1 --project=med-buddy-503802 --format='yaml(name,location,rateLimits,retryConfig)'
	gcloud storage buckets describe gs://medbuddy-prototype-attachments-643586490631-us-west1 --format='yaml(location,public_access_prevention,uniform_bucket_level_access,versioning_enabled)'
