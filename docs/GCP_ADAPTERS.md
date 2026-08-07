# GCP adapter operational notes

## Dependency exception

The Firestore, Cloud Tasks, and Cloud Storage adapters use compatible Google
Cloud Node clients. On 2026-08-04, `npm audit --omit=dev` reported nine
findings: four high and five moderate. npm offered ordinary updates for some
high transitive paths, but proposed a breaking downgrade of Cloud Storage to
5.18.3 for the moderate chain. No automatic dependency change was authorized.

This is an accepted prototype exception, not a clean production audit.

- The high `brace-expansion` advisory is in Firestore `rimraf`/`glob` cleanup
  tooling. The runtime does not use that path.
- The high PostCSS advisories apply to trusted checked-in build CSS. The app
  does not accept user CSS or source maps.
- The high Sharp/libvips advisories apply to Next.js's optional image path.
  The app does not use `next/image` or remote-image configuration. LINE
  attachment ingestion verifies signatures and stores bytes without Sharp.
- The five moderate findings are the `uuid` advisory and the
  `gaxios`/`teeny-request`/`retry-request`/Storage chain. The vulnerable API
  accepts an output buffer for UUID v3, v5, or v6. These clients use UUID v4,
  and the adapter does not call the buffer APIs.

Do not apply the suggested major Storage downgrade or forced transitive
overrides without focused live-GCP compatibility work. Emulator tests cannot
prove live-GCP behavior. Before real-data deployment, run
`npm audit --omit=dev` again and upgrade to the first compatible releases that
remove these paths. Keep real health data out of production until the audit is
clean, or a security owner records a time-bounded acceptance with compensating
controls.

Do not use service-account keys. Use workload identity, a private
uniform-access bucket, and a dedicated Cloud Tasks callback service account.

On 2026-08-04, the Firestore-emulator suite passed 48 files and 388 tests with
Homebrew OpenJDK 26. The credential-gated live Vertex smoke was the only
skipped file; it is not an adapter test.

## Production composition

The production compositions validate configuration before they construct
Firestore, Cloud Tasks, or Storage adapters. Errors name only the invalid or
missing setting; they never echo a value.

- Capture composition: `MEDBUDDY_GCP_PROJECT_ID`,
  `MEDBUDDY_TASKS_LOCATION`, `MEDBUDDY_TASKS_QUEUE`,
  `MEDBUDDY_CAPTURE_CALLBACK_URL`,
  `MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL`, and
  `MEDBUDDY_ATTACHMENT_BUCKET`.
- Continuity composition: `MEDBUDDY_GCP_PROJECT_ID`,
  `MEDBUDDY_TASKS_LOCATION`, `MEDBUDDY_TASKS_QUEUE`,
  `MEDBUDDY_CONTINUITY_CALLBACK_URL`,
  `MEDBUDDY_ATTACHMENT_CALLBACK_URL`,
  `MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL`,
  `MEDBUDDY_ATTACHMENT_BUCKET`,
  `MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION`, and
  `MEDBUDDY_ATTACHMENT_LOCATOR_KEY` (secret).

The composition does not provision the project, IAM roles, regional queue,
service account, bucket, or credentials. A GCP project owner must provide
deployment decisions and workload-identity access.

`FictionalDemoWorkspaceProvisioner` is the only production path that creates
reviewer data. It copies the approved, committed, versioned fictional template
with one fixed owner and two caregiver personas. The credential-test workspace
is seeded separately and never receives a reviewer mapping. A reset creates a
replacement workspace and remaps the reviewer. It does not change prior facts
or handoff versions.

## Vertex Intelligence adapter

Fixed adapters are the normal development and test path. The live Vertex REST
adapter is opt-in. Set `MEDBUDDY_VERTEX_ENABLED=true`,
`MEDBUDDY_VERTEX_PROJECT`, and optionally `MEDBUDDY_VERTEX_LOCATION` and
`MEDBUDDY_VERTEX_MODEL`, then provide Application Default Credentials. Do not
commit credentials in environment files.

Conversation and tool use run on `gemini-3.6-flash`. Single-purpose compaction
uses `MEDBUDDY_COMPACTION_VERTEX_MODEL`, validated as
`gemini-3.5-flash-lite`. Both use the Vertex `global` location. Each request
has bounded input and timeout; timeouts return a typed provider-timeout
outcome.

Run the fictional-only live smoke test:

```sh
MEDBUDDY_VERTEX_ENABLED=true MEDBUDDY_VERTEX_PROJECT=your-project npm run test:vertex-smoke
```

The smoke sends fictional text and a transparent one-pixel PNG. It does not
write Firestore, Storage, or a canonical record. The adapter JSON-parses and
schema-validates live output at conversation, text-capture, and readable-label
boundaries before Intelligence receives it. Medication-decision refusal occurs
before the provider call. Medication claims come only from source cards. Image
output becomes raw printed-label text or an unresolved outcome. The adapter has
no UI, repository, or Firestore handle; Chat/UI rendering is a later concern.
