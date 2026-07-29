# `@medbuddy/contracts`

Shared Zod schemas, branded IDs, errors, public service ports, and golden-scenario fixtures.

## Public entry

- `.` → `src/index.ts` (schemas, types, ports, `GoldenScenario`)
- `./adapter-contract-tests` → shared persistence adapter contract harness
- `./transaction-contract-tests` → transactional persistence contract harness

## Depends on

- `zod`

## Must not

- Perform I/O or call cloud SDKs
- Implement chat, review, capture, or handoff policy beyond pure schema constraints

## Key surfaces

- Ports: `ChatService`, `CareRecordService`, `ConversationResponder`, `CaptureProcessor`, `MedicationGrounding`, `DemoWorkspaceProvisioner`
- Domains: auth, chat, capture, care-record, handoff, grounding, persistence, demo

## Tests

```bash
npm test --workspace @medbuddy/contracts
```
