# `@medbuddy/chat`

Deterministic chat application service: append/list messages, request capture retry, and orchestrate isolated LINE turns with one workspace family map.

## Public entry

- `.` → `ChatService`, `ThreadConversationService`, and local ports

`ThreadConversationService` loads messages and the family map from exactly one
workspace, then binds workspace, actor, and source-message identity around the
narrow update capability passed to Intelligence.

`DynamicMemoryService` is shared by active tools and the silent passive worker.
Passive proposals use deterministic per-source slots, preserve edit lineage,
and return a typed conflict when a retry changes an existing operation.

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
