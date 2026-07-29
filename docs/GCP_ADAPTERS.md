# GCP adapter operational notes

The Firestore, Cloud Tasks, and Cloud Storage adapters use the current
compatible Google Cloud Node clients. As of 2026-07-28, `npm audit --omit=dev`
reports transitive advisories in `google-gax` and Cloud Storage's legacy HTTP
dependency chain. The affected current Google client versions have no
non-breaking patched release: `google-gax` 5.0.8 is the latest compatible
release, and npm proposes a breaking downgrade of Cloud Storage to 5.18.3.

This is an explicitly accepted prototype dependency exception, not a claim of
a clean production audit. On 2026-07-29, the production-only audit reports 10
transitive findings (5 high and 5 moderate):

- Firestore and Tasks share `google-gax@5.0.8`'s `rimraf@5` → `glob@10` →
  `minimatch@9` → `brace-expansion@2` chain (5 high findings).
- Storage's supported dependency ranges resolve to `gaxios@6.7.1` and
  `teeny-request@9.0.0` / `retry-request@7.0.2`, which retain `uuid@9`
  (5 moderate findings).

The Google client releases above are the current compatible releases. The
available audit remediation proposes downgrading Storage across a major version
to `@google-cloud/storage@5.18.3`, so it must not be applied. We also rejected
forcing current major versions of `rimraf`, `gaxios`, `teeny-request`, or
`retry-request` through npm overrides: those versions are outside their Google
clients' declared compatibility ranges, and local adapter tests cannot prove
their behavior against live GCP APIs.

Before any real-data deployment, re-run `npm audit --omit=dev` and upgrade to
the first compatible Google client releases that remove these transitive paths.
Keep real health data out of production until that audit is clean or a security
owner records a time-bounded risk acceptance with compensating controls.
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
