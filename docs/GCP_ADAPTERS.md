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

## Vertex Intelligence adapter

`@medbuddy/intelligence` keeps fixed adapters as the normal development and
test path. The live Vertex REST adapter is opt-in: set
`MEDBUDDY_VERTEX_ENABLED=true`, `MEDBUDDY_VERTEX_PROJECT`, and (optionally)
`MEDBUDDY_VERTEX_LOCATION` / `MEDBUDDY_VERTEX_MODEL`, then provide Application
Default Credentials. Do not put credentials in environment files committed to
the repository. The default `gemini-3.6-flash` configuration uses Vertex's
`global` location; supply both a regional model and its location when using a
regional endpoint. Each request has a bounded timeout and returns a typed
provider-timeout outcome when it expires.

Run the live, fictional-only smoke tests with:

```sh
MEDBUDDY_VERTEX_ENABLED=true MEDBUDDY_VERTEX_PROJECT=your-project npm run test:vertex-smoke
```

The smoke uses a fictional text message and a transparent one-pixel PNG. It
does not write Firestore, Storage, or any canonical record. Live output is
parsed as JSON and schema-validated at the conversation, text-capture, and
readable-label boundaries before the existing Intelligence logic receives it.
Medication-decision refusal still happens before a provider call, medication
claims still come only from source cards, and image output can only become raw
printed-label text or an unresolved outcome. Chat/UI rendering remains a later
integration concern; this adapter deliberately has no UI, repository, or
Firestore handle.
