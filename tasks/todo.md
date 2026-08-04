# Long-Running Conversation Continuity Checklist

**Status:** Approved for implementation

## Approval gates

- [x] Read the binding repository and prototype instructions.
- [x] Reconcile Effort 2 with the implemented Effort 1 family map.
- [x] Obtain explicit user approval of the Effort 2 design.
- [x] Record `gemini-3.6-flash` as the user-selected model.
- [x] Obtain explicit user approval of this implementation plan and checklist.
- [x] Re-fetch and verify the exact `origin/main` implementation base (`ee3b63b5ddb84d70dbba91b72ecef8bd8ef8daf1`).
- [x] Create the dedicated clean implementation worktree and `codex/` branch.

## Implementation

- [ ] Task 1: Define continuity contracts and identifiers test-first.
- [ ] Task 2: Add the reusable source-ledger adapter contract.
- [ ] Task 3: Implement and verify the in-memory continuity adapter.
- [ ] Checkpoint A: Contracts, adapter tests, and `npm run check` pass.
- [ ] Task 4: Implement projection and deterministic context assembly.
- [ ] Task 5: Implement compaction planning, validation, and publication policy.
- [ ] Task 6: Add bounded four-field summary generation for `gemini-3.6-flash`.
- [ ] Checkpoint B: Chat and Intelligence continuity suites pass.
- [ ] Task 7: Implement and emulator-test the Firestore adapter.
- [ ] Task 8: Add durable compaction dispatch and private task execution.
- [ ] Task 9: Replace count-based LINE orchestration and publish outbound only after acceptance.
- [ ] Task 10: Add private bounded LINE attachment ingestion.
- [ ] Checkpoint C: Synthetic LINE continuity and attachment paths pass.
- [ ] Task 11: Complete production configuration and content-free observability.

## Independent verification

- [ ] Implementer completes small logical commits and reports evidence.
- [ ] Fresh-context verifier reviews design, plan, full diff, isolation, privacy, and safety.
- [ ] Implementer fixes every actionable finding.
- [ ] Fresh-context verifier reruns affected and full verification until clean.

## Final gates

- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run build --workspace @medbuddy/web`
- [ ] `npm audit --omit=dev` with reachable findings triaged.
- [ ] Fictional fixtures only; staged diff contains no PII, health information, credentials, or secrets.
- [ ] Logs contain no content, summaries, excerpts, identifiers, prompts, attachment metadata, or object references.
- [ ] Exact Git state, commits, tests, residual risks, and deferred fictional smoke are handed back.
- [ ] No deployment, PR creation, PR merge, or branch merge was performed.
