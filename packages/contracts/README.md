# `@medbuddy/contracts`

Shared Zod schemas, branded IDs, errors, public service ports, and golden-scenario fixtures.

## Public entry

- `.` → `src/index.ts` (schemas, types, ports, `GoldenScenario`)
- `./adapter-contract-tests` → shared persistence adapter contract harness
- `./workspace-family-map-adapter-contract-tests` → shared family-map CAS/isolation harness
- `./transaction-contract-tests` → transactional persistence contract harness

## Depends on

- `zod`

## Must not

- Perform I/O or call cloud SDKs
- Implement chat, review, capture, or handoff policy beyond pure schema constraints

## Key surfaces

- Ports: `ChatService`, `CareRecordService`, `ConversationResponder`, `WorkspaceFamilyMapRepository`, transactional `DynamicMemoryRepository`, `CaptureProcessor`, `MedicationGrounding`, `DemoWorkspaceProvisioner`
- Domains: auth, chat, workspace family map, dynamic memory, capture, care-record, handoff, grounding, persistence, demo

## Tests

```bash
npm test --workspace @medbuddy/contracts
```
