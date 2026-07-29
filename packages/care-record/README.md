# `@medbuddy/care-record`

Deterministic care-record domain: workspace eligibility, facts, review actions, and immutable handoffs.

## Public entry

- `.` → authorization helpers, facts, review, handoff

## Depends on

- `@medbuddy/contracts`

## Must not

- Talk to the model or invent clinical advice
- Perform HTTP or vendor SDK I/O
- Rewrite immutable handoff versions

## Tests

```bash
npm test --workspace @medbuddy/care-record
```
