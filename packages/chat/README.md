# `@medbuddy/chat`

Deterministic chat application service: append/list messages, request capture retry, orchestrate isolated LINE turns, and own source-backed dynamic-memory proposal and retrieval policy.

## Public entry

- `.` → `ChatService`, `ThreadConversationService`, and local ports

`ThreadConversationService` loads messages and the family map from exactly one
workspace, then binds workspace, actor, and source-message identity around the
narrow family-map and dynamic-memory capabilities passed to Intelligence.

`DynamicMemoryService` scans only current dynamic-memory records from one
trusted workspace. Query filters are literal and deterministic; source excerpts
are exact, bounded evidence, and incomplete or uncertain reads fail explicitly.

`DynamicMemoryService` is shared by active tools and the silent passive worker.
Passive proposals are validated and materialized without storage mutation;
the fenced passive job repository owns their atomic batch commit. Deterministic
per-source slots preserve edit lineage and make array-order retries stable.

## Depends on

- `@medbuddy/contracts`
- `@medbuddy/care-record` (workspace eligibility)

## Must not

- Call Vertex or parse model output
- Own review or handoff construction
- Import GCP client libraries

## Tests

```bash
npm test --workspace @medbuddy/chat
```
