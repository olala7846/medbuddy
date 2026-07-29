# GCP adapter operational notes

The Firestore, Cloud Tasks, and Cloud Storage adapters use the current
compatible Google Cloud Node clients. As of 2026-07-28, `npm audit --omit=dev`
reports transitive advisories in `google-gax` and Cloud Storage's legacy HTTP
dependency chain. The affected current Google client versions have no
non-breaking patched release: `google-gax` 5.0.8 is the latest compatible
release, and npm proposes a breaking downgrade of Cloud Storage to 5.18.3.

This is an explicitly accepted prototype dependency exception, not a claim of
a clean production audit. Before deployment, re-check the audit and upgrade to
the first compatible Google client releases that remove these transitive paths.
Do not use service-account keys: deploy with workload identity, a private
uniform-access bucket, and a dedicated Cloud Tasks callback service account.

## Production composition status

The application composition validates these required, non-secret settings before
constructing Firestore, Cloud Tasks, or Storage adapters:

- `MEDBUDDY_GCP_PROJECT_ID`
- `MEDBUDDY_TASKS_LOCATION`
- `MEDBUDDY_TASKS_QUEUE`
- `MEDBUDDY_CAPTURE_CALLBACK_URL`
- `MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL`
- `MEDBUDDY_ATTACHMENT_BUCKET`

Invalid or absent configuration reports only setting names; values are never
echoed. The composition intentionally does not provision a project, IAM roles,
regional queue, service account, bucket, or credentials. Those external steps
remain blocked until a GCP project owner supplies the deployment decisions and
workload identity access.

`FictionalDemoWorkspaceProvisioner` is the only production composition path
that creates reviewer data. It creates an approved copy of the committed
versioned fictional template with the fixed owner and two caregiver personas.
The dedicated credential-test workspace is seeded separately and never receives
a reviewer mapping. Reset creates a replacement workspace and remaps the
reviewer; it never changes prior facts or handoff versions.
