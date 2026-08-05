# Deployment readiness and external blockers

**Status:** prototype code is complete; no production GCP deployment has been
provisioned or claimed.

## Current local evidence

- The machine has an active `gcloud` user session.
- The selected CLI project is `med-buddy-503802`; billing is enabled and the
  active user has owner access for the prototype foundation apply.
- The selected prototype region is `us-west1`. Firestore, Cloud Tasks, Cloud
  Run, and Cloud Storage will remain co-located there where supported.
- The default Java is 17, and Homebrew OpenJDK 26 is available explicitly for
  the current Google Cloud Firestore emulator. On 2026-08-04 the focused
  continuity contract and the complete emulator-enabled suite passed using
  that JRE. The final remediation run passed 48 files and 379 tests; only the
  live-provider file remained gated. Emulator skips are not treated as
  evidence.
- `npm audit --omit=dev` reports 9 findings: 4 high and 5 moderate. The high
  findings are in Firestore cleanup tooling and Next.js build/optional-image
  paths. The moderate chain reaches the Storage client but concerns UUID
  v3/v5/v6 buffer APIs that the adapter does not call. This reachability triage
  is a documented prototype exception, not a clean production audit.

## What needs an owner decision or authorization

1. Apply the reviewed Terraform foundation for the selected project and
   `us-west1` region. This will create an irreversible Native-mode Firestore
   default database and the protected foundation resources described below.
2. Authorize creation or reuse of these resources:
   - Firestore database;
   - Cloud Tasks queue;
   - private, uniform-bucket-level-access Cloud Storage bucket;
   - Cloud Run capture-callback service;
   - dedicated Cloud Tasks callback service account;
   - workload-identity deployment path (never a committed service-account
     key).
3. Approve least-privilege IAM bindings for the runtime and deployer service
   accounts. The exact bindings should be reviewed against the selected
   project and deployment architecture before any policy change.
4. Accept or remediate the production dependency audit finding before handling
   real health information. It must be re-run immediately before deployment.
5. Keep a Java 21+ JRE available in development/CI and continue running the
   complete Firestore-emulator-enabled suite before deployment.

## What an agent can safely do now with the existing `gcloud` login

The agent can perform these read-only preflight checks without creating
resources or changing IAM:

```sh
gcloud auth list
gcloud projects list
gcloud services list --enabled --project=PROJECT_ID
gcloud firestore databases list --project=PROJECT_ID
gcloud tasks queues list --location=REGION --project=PROJECT_ID
gcloud storage buckets list --project=PROJECT_ID
gcloud iam service-accounts list --project=PROJECT_ID
gcloud projects get-iam-policy PROJECT_ID
```

After you explicitly choose `PROJECT_ID` and `REGION`, the agent can also
produce a dry-run deployment plan: required APIs, names for the queue/bucket/
service accounts, least-privilege IAM roles, environment-variable values, and
verification commands. It can validate that the account has the needed
permissions before attempting any mutation.

## Actions the agent should take only with explicit authorization

These are external, potentially billable or security-sensitive state changes:

- enable GCP APIs;
- create or change Firestore, Cloud Tasks, Storage, Cloud Run, or service
  account resources;
- change IAM policies or workload-identity bindings;
- set a shared/default `gcloud` project or deploy an image/service;
- install Java or other host-level software.

Once authorized, use Application Default Credentials or workload identity; do
not pass credentials in source files, committed environment files, task
payloads, or issue comments.

## Runtime configuration to supply after provisioning

The production and private continuity compositions require these settings:

- `MEDBUDDY_GCP_PROJECT_ID`
- `MEDBUDDY_TASKS_LOCATION`
- `MEDBUDDY_TASKS_QUEUE`
- `MEDBUDDY_CAPTURE_CALLBACK_URL`
- `MEDBUDDY_CONTINUITY_CALLBACK_URL`
- `MEDBUDDY_ATTACHMENT_CALLBACK_URL`
- `MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL`
- `MEDBUDDY_ATTACHMENT_BUCKET`
- `MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION`
- `MEDBUDDY_ATTACHMENT_LOCATOR_KEY` (secret; canonical base64 for 32 bytes)

Missing values fail safely by naming only the missing setting; values are not
echoed. The Vertex adapter, if enabled separately, also needs a selected
project and Application Default Credentials. Its fictional-only smoke test
does not write canonical data.
