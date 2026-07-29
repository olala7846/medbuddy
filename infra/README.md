# MedBuddy prototype infrastructure

Terraform manages only the selected prototype foundation in project
`med-buddy-503802`, region `us-west1`. It does not deploy a container, create a
Cloud Run service, configure a callback URL, provision Vertex, or authorize
real health data.

The foundation creates the Native-mode default Firestore database, a private
attachment bucket, the capture queue, and keyless runtime/task-invoker service
accounts. The attachment bucket deliberately has no automatic expiry until a
reviewed retention policy exists.

Cloud Tasks receives `roles/iam.serviceAccountUser` on the dedicated callback
invoker identity, following the documented HTTP-target OIDC flow. The later
Cloud Run deployment slice will grant that invoker identity `roles/run.invoker`
on the service; this foundation does not create the service or grant that role.

## Prerequisites

Use the approved local user credentials only; do not create or download a
service-account key.

```sh
gcloud config set project med-buddy-503802
gcloud auth application-default login
gcloud auth application-default set-quota-project med-buddy-503802
terraform version
```

The local user must be authorized to enable project services, create the
Firestore default database, create regional storage/queue resources, and set
the IAM bindings described in the Terraform configuration.

## Bootstrap the Terraform backend

The bootstrap root intentionally starts with local state so it can create the
remote state bucket. Local state is ignored by Git; retain it securely because
it records ownership of the state bucket.

```sh
cd infra/terraform/bootstrap
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

It creates `medbuddy-tf-state-643586490631-us-west1`: a private, versioned
bucket with public access prevention. Terraform never destroys that bucket.

Alternatively, run the one-time workflow from the repository root:

```sh
make infra-bootstrap
```

## Apply the prototype foundation

```sh
cd infra/terraform/prototype
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
terraform output
```

The first apply creates the irreversible `(default)` Native-mode Firestore
database in `us-west1`. Review the saved plan before applying it. The database
has delete protection and Terraform prevent-destroy protection.

## Future infrastructure changes

After the one-time bootstrap, the normal GCS-backed workflow is one command
from the repository root:

```sh
make infra-apply
```

It re-initializes the remote backend, checks formatting, validates the
configuration, saves and displays `tfplan`, then asks Terraform for the final
apply confirmation. Use `make infra-plan` to stop after planning,
`make infra-output` to read outputs, and `make infra-verify` for read-only GCP
checks. Plan files and local bootstrap state remain ignored by Git.

## Verify after apply

```sh
gcloud firestore databases list --project=med-buddy-503802
gcloud tasks queues describe medbuddy-capture --location=us-west1 --project=med-buddy-503802
gcloud storage buckets describe gs://medbuddy-prototype-attachments-643586490631-us-west1
gcloud iam service-accounts list --project=med-buddy-503802
```

Run the Firestore emulator suite after Java is available. Re-run
`npm audit --omit=dev` before any real-data deployment; the current Google
client advisory exception remains a release gate. See
[`docs/DEPLOYMENT_READINESS.md`](../docs/DEPLOYMENT_READINESS.md) and
[`docs/GCP_ADAPTERS.md`](../docs/GCP_ADAPTERS.md).

## Sources

- https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_service
- https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_firestore_database
- https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_cloud_tasks_queue
- https://cloud.google.com/tasks/docs/creating-http-target-tasks
