# `@medbuddy/platform`

I/O adapters: Firestore repositories (including the current workspace family map), Cloud Tasks dispatcher/verify, Cloud Storage attachments, in-memory test implementations, demo-workspace persistence, production factory.

The Firestore and in-memory family-map adapters implement the same source-bound,
workspace-isolated compare-and-set contract. Firestore stores only
`workspaces/{workspaceId}/workspaceMemory/familyMap`; there is no history collection.

Passive-memory adapters expose only capped effective human text/edit ranges and
bounded edit lineage, plus leased workspace jobs. Successful dynamic-memory
records, terminal state, and the cursor commit atomically behind the attempt
fence; failed or stale attempts create no active records.

## Public entry

- `.` → adapters and `createProductionPlatform`

## Depends on

- `@medbuddy/contracts`
- `@google-cloud/firestore`, `@google-cloud/storage`, `@google-cloud/tasks`, `google-auth-library`

## Must not

- Own consent, safety routing, review authority, or handoff content policy
- Import `@medbuddy/chat`, `@medbuddy/care-record`, or `@medbuddy/intelligence` domain modules for policy

## Tests

```bash
npm test --workspace @medbuddy/platform
```

Firestore emulator and live GCP paths need local credentials/emulators; see [docs/GCP_ADAPTERS.md](../../docs/GCP_ADAPTERS.md) and [infra/README.md](../../infra/README.md).
