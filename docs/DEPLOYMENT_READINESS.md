# Deployment readiness and external blockers

**Status:** Prototype code is complete. No production GCP deployment is
provisioned or claimed.

## Local evidence

- The machine has an active `gcloud` user session.
- The selected CLI project is `med-buddy-503802`; billing is enabled. The
  active user can apply the prototype foundation as an owner.
- The selected prototype region is `us-west1`. Keep Firestore, Cloud Tasks,
  Cloud Run, and Cloud Storage there where the service supports it.
- The default Java is 17. Homebrew OpenJDK 26 supports the current Google
  Cloud Firestore emulator. On 2026-08-04, the focused continuity contract
  and full emulator-enabled suite passed with that JRE. The final remediation
  run passed 48 files and 388 tests. Only the live-provider file remained
  gated. Do not treat emulator skips as evidence.
- `npm audit --omit=dev` reports nine findings: four high and five moderate.
  High findings are in Firestore cleanup tooling and Next.js
  build/optional-image paths. The moderate chain reaches the Storage client,
  but concerns UUID v3/v5/v6 buffer APIs that the adapter does not call. This
  documented prototype exception is not a clean production audit.

## Owner decisions and authorization required

1. Apply the reviewed Terraform foundation to the selected project and
   `us-west1`. It creates the irreversible Native-mode Firestore default
   database and protected foundation resources below.
2. Authorize creation or reuse of:
   - the Firestore database;
   - the Cloud Tasks queue;
   - a private Cloud Storage bucket with uniform bucket-level access;
   - the Cloud Run capture-callback service;
   - a dedicated Cloud Tasks callback service account; and
   - a workload-identity deployment path. Never commit a service-account key.
3. Approve least-privilege IAM bindings for runtime and deployer accounts.
   Review exact bindings against the project and deployment architecture before
   any policy change.
4. Accept or remediate the production dependency audit finding before handling
   real health information. Re-run the audit immediately before deployment.
5. Keep a Java 21+ JRE in development and CI. Run the complete
   Firestore-emulator-enabled suite before deployment.

## Safe actions with the existing `gcloud` login

The agent can run these read-only preflight checks. They do not create
resources or change IAM:

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

After you explicitly choose `PROJECT_ID` and `REGION`, the agent can produce a
dry-run plan with required APIs; queue, bucket, and service-account names;
least-privilege IAM roles; environment-variable values; and verification
commands. It can validate account permissions before a mutation.

## Actions that require explicit authorization

These actions change external, billable, or security-sensitive state:

- enable GCP APIs;
- create or change Firestore, Cloud Tasks, Storage, Cloud Run, or service
  account resources;
- change IAM policies or workload-identity bindings;
- set a shared/default `gcloud` project or deploy an image/service;
- install Java or other host-level software.

After authorization, use Application Default Credentials or workload identity.
Do not put credentials in source files, committed environment files, task
payloads, or issue comments.

## Runtime configuration after provisioning

Production and private-continuity compositions require:

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

Missing values fail safely. The system names only the missing setting and does
not echo values. The separate Vertex adapter also needs a selected project and
Application Default Credentials. Its fictional-only smoke test does not write
canonical data.
