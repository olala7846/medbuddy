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

- [x] Task 1: Define continuity contracts and identifiers test-first.
- [x] Task 2: Add the reusable source-ledger adapter contract.
- [x] Task 3: Implement and verify the in-memory continuity adapter.
- [x] Checkpoint A: Contracts, adapter tests, and `npm run check` pass.
- [x] Task 4: Implement projection and deterministic context assembly.
- [x] Task 5: Implement compaction planning, validation, and publication policy.
- [x] Task 6: Add bounded four-field summary generation for `gemini-3.6-flash`.
- [x] Checkpoint B: Chat and Intelligence continuity suites pass.
- [x] Task 7: Implement and emulator-test the Firestore adapter.
- [x] Task 8: Add durable compaction dispatch and private task execution.
- [x] Task 9: Replace count-based LINE orchestration and publish outbound only after acceptance.
- [x] Task 10: Add private bounded LINE attachment ingestion.
- [x] Checkpoint C: Synthetic LINE continuity and attachment paths pass.
- [x] Task 11: Complete production configuration and content-free observability.

## Independent verification

- [x] Implementer completes small logical commits and reports evidence.
- [ ] Fresh-context verifier reviews design, plan, full diff, isolation, privacy, and safety.
- [x] Implementer fixes every actionable finding.
- [ ] Fresh-context verifier reruns affected and full verification until clean.

### Verifier remediation

- [x] Bound the complete assembled and serialized provider context, reserve
  output tokens, retain only a bounded newest historical frontier, and count
  action wrappers/separators.
- [x] Keep the selected recent window contiguous by stopping at the first
  older non-fitting turn.
- [x] Preserve sender-less LINE group/room unsends and accept text through the
  100,000-character contract boundary.
- [x] Invalidate compaction candidates on later in-range mutations, bound
  compaction input, and make failed work recoverable.
- [x] Prevent historical summaries from authorizing family-map mutation.
- [x] Self-schedule remaining compaction backlog after publication and claim
  model attempts atomically.
- [x] Reject attachment media-class/MIME mismatches.
- [x] Reconcile stale app/web Storage and continuity documentation.
- [x] Rerun all verification gates.
- [x] Add crash-safe expiring compaction attempt leases with transactional
  takeover in memory and Firestore.
- [x] Fence every attempt-owned state transition and publication so an expired
  worker cannot overwrite or clear its transactional takeover successor.
- [x] Reload the source ledger after Gemini and enforce its validated watermark
  atomically at level-1 publication.
- [x] Replace family-map authority heuristics with a structural allowlist that
  denies interrogatives, uncertainty, and negation independently of punctuation.
- [x] Stabilize attachment emulator contention and correct deployment/audit docs.
- [x] Update the executable LINE deployment template to `gemini-3.6-flash`
  with the private continuity callbacks, task identity, bucket, and encrypted
  locator secret mapping.
- [x] Rerun final-verifier remediation gates.

## Final gates

- [x] `npm run check`
- [x] `npm test`
- [x] `npm run build --workspace @medbuddy/web`
- [x] `npm audit --omit=dev` with reachable findings triaged.
- [x] Fictional fixtures only; staged diff contains no PII, health information, credentials, or secrets.
- [x] Logs contain no content, summaries, excerpts, identifiers, prompts, attachment metadata, or object references.
- [ ] Exact Git state, commits, tests, residual risks, and deferred fictional smoke are handed back.
- [x] No deployment, PR creation, PR merge, or branch merge was performed.

## Implementer verification evidence (2026-08-04)

- `npm run check`: passed.
- `npm test`: 46 files and 346 tests passed; 3 files and 51 tests were
  configuration-gated and skipped.
- `npm run build --workspace @medbuddy/web`: passed, including the private
  `/api/internal/attachment` and `/api/internal/continuity` routes.
- Full Firestore-emulator-enabled suite: 48 files and 379 tests passed; one
  live-provider file and 18 tests remained configuration-gated. The focused
  continuity contract passed 9 tests, including concurrent atomic attachment
  and compaction-attempt allocation, expired-lease takeover, publication
  watermark enforcement, failed-job reclaim, and stale-owner fencing after
  transactional takeover. The focused contract plus worker suite passed 21
  tests.
- The broader legacy concurrent-message emulator test now allows 20 seconds
  and asserts unique revisions without assuming concurrent submission order;
  the complete emulator-enabled rerun passed.
- Checkpoint C: Web 74 passed/5 skipped; Chat 38 passed/5 skipped.
- `npm audit --omit=dev`: completed with 9 transitive findings (4 high, 5
  moderate). `brace-expansion` is under Firestore's `rimraf/glob` tooling;
  vulnerable PostCSS behavior is limited to trusted checked-in build CSS;
  the application has no `next/image` or remote-image configuration reaching
  Sharp; and the affected UUID v3/v5/v6 buffer APIs are not used by the
  `gaxios`/`teeny-request` paths, which call UUID v4. The audit-suggested Storage
  remediation is an unsafe major downgrade, while the safe Next/Sharp update is
  intentionally deferred to a focused dependency change. Real-family-data
  release gates remain closed.
- The configuration-gated live `gemini-3.6-flash` smoke remains skipped and
  must pass in the target project/region before deployment.
