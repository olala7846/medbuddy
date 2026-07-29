# `@medbuddy/chat`

Deterministic chat application service: append and list messages, request capture retry.

## Public entry

- `.` → `ChatService` implementation and local ports

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
