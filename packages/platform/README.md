# `@medbuddy/platform`

I/O adapters: Firestore repositories (including workspace family maps, current dynamic memory, and exact source-evidence lookup), Cloud Tasks dispatcher/verify, Cloud Storage attachments, in-memory test implementations, demo-workspace persistence, production factory.

The Firestore and in-memory family-map adapters implement the same source-bound,
workspace-isolated compare-and-set contract. Firestore stores only
`workspaces/{workspaceId}/workspaceMemory/familyMap`; there is no history collection.

Dynamic-memory adapters expose deterministic current/history scans capped at
500 records plus atomic, idempotent lifecycle transitions. Lifecycle events are
auditable metadata; correction successors and source-lineage lookups remain
workspace-path-bound. The adapters do not search raw conversation, continuity
compaction, relationship maps, or reviewed-care records.

Passive-memory adapters expose only capped effective human text/edit ranges and
bounded edit lineage, reserving one lineage slot for the original and at most 31
edits. Overflow fails closed for retry rather than producing empty evidence.
Successful dynamic-memory records, terminal state, and the cursor commit
atomically behind the attempt fence; failed or stale attempts create no active
records.

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
