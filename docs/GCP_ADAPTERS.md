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
