# GCP adapter operational notes

The Firestore, Cloud Tasks, and Cloud Storage adapters use the current
compatible Google Cloud Node clients. As of 2026-08-04, `npm audit --omit=dev`
reports 9 findings (4 high and 5 moderate). npm proposes normal updates for
some high transitive paths and a breaking downgrade of Cloud Storage to 5.18.3
for the moderate chain; no automatic dependency mutation was authorized.

This is an explicitly accepted prototype dependency exception, not a claim of
a clean production audit. Current reachability triage is:

- One high `brace-expansion` advisory is under Firestore's `rimraf`/`glob`
  cleanup tooling; the application runtime does not invoke that cleanup path.
- High PostCSS advisories are limited to trusted checked-in build CSS; the
  application does not accept user-authored CSS or source maps.
- High Sharp/libvips advisories are in Next.js's optional image path. The app
  has no `next/image` or remote-image configuration, and LINE attachment
  ingestion validates signatures and stores bytes without invoking Sharp.
- The five moderate entries are the `uuid` advisory and its
  `gaxios`/`teeny-request`/`retry-request`/Storage dependency chain. The
  vulnerable operation is an explicitly supplied output buffer for UUID
  v3/v5/v6; these client paths use UUID v4 and the MedBuddy adapter never calls
  those buffer APIs directly.

The audit remediation that covers the moderate chain proposes downgrading
Storage across a major version to `@google-cloud/storage@5.18.3`, so it must
not be applied without a focused compatibility change. Forced transitive
overrides likewise remain inappropriate because emulator tests cannot prove
behavior against live GCP APIs.

Before any real-data deployment, re-run `npm audit --omit=dev` and upgrade to
the first compatible Google client releases that remove these transitive paths.
Keep real health data out of production until that audit is clean or a security
owner records a time-bounded risk acceptance with compensating controls.
Do not use service-account keys: deploy with workload identity, a private
uniform-access bucket, and a dedicated Cloud Tasks callback service account.

On 2026-08-04 the complete Firestore-emulator-enabled suite passed 48 files and
388 tests using Homebrew OpenJDK 26. The remaining skipped file is the
credential-gated live Vertex smoke, not an adapter test.

## Production composition status

The application compositions validate these required settings before
constructing Firestore, Cloud Tasks, or Storage adapters:

- `MEDBUDDY_GCP_PROJECT_ID`
- `MEDBUDDY_TASKS_LOCATION`
- `MEDBUDDY_TASKS_QUEUE`
- `MEDBUDDY_CAPTURE_CALLBACK_URL`
- `MEDBUDDY_CONTINUITY_CALLBACK_URL`
- `MEDBUDDY_ATTACHMENT_CALLBACK_URL`
- `MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL`
- `MEDBUDDY_ATTACHMENT_BUCKET`
- `MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION`
- `MEDBUDDY_ATTACHMENT_LOCATOR_KEY` (secret)

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
the repository. Conversation and tool use stay on `gemini-3.6-flash`;
single-purpose compaction uses `MEDBUDDY_COMPACTION_VERTEX_MODEL`, validated as
`gemini-3.5-flash-lite`. Both use Vertex's `global` location. Each model request
has bounded input and a bounded timeout, and returns a typed provider-timeout
outcome when it expires.

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
