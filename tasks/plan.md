# Implementation Plan: Long-Running Conversation Continuity

**Status:** Approved for implementation

**Requirements:** [`../docs/proposals/LONG_RUNNING_CONVERSATION_CONTINUITY_DESIGN.md`](../docs/proposals/LONG_RUNNING_CONVERSATION_CONTINUITY_DESIGN.md)

**Target model:** `gemini-3.6-flash`

## Outcome

Deliver one complete LINE-first continuity path:

```text
signed LINE event
  -> atomic deduplication + workspace source sequence
  -> immutable attributed source evidence
  -> deterministic bounded context
  -> optional reply through existing agent/family-map loop
  -> LINE acceptance before outbound evidence publication
  -> durable asynchronous compaction and attachment work
```

The implementation stays inside the existing TypeScript modular monolith and
uses Firestore, Cloud Tasks, Cloud Storage, Cloud Run, and in-memory test
adapters. It adds no database, worker service, vector index, agent framework,
or generalized retrieval/tool runtime.

## Architecture decisions

- `@medbuddy/contracts` owns schemas and narrow interfaces only.
- `@medbuddy/chat` owns source projection, recent-window selection, context
  assembly, compaction policy, and turn orchestration.
- `@medbuddy/intelligence` owns the four-field summary request/response and the
  existing Vertex transport, configured for `gemini-3.6-flash`.
- `@medbuddy/platform` owns in-memory and Firestore repository mechanics,
  Cloud Tasks dispatch, and private Cloud Storage mechanics.
- `@medbuddy/web` owns strict LINE shapes, reply acceptance, private task
  endpoints, composition, and content-free operational logging.
- The Effort 1 family-map contracts and repository remain unchanged. The
  existing message store is a compatibility projection; source sequence is the
  only continuity ordering coordinate.
- All code is implemented test-first in small commits. The implementation agent
  has no deploy, PR, or merge authority.

## Dependency order and tasks

### Task 1: Define continuity contracts and identifiers

**Description:** Add branded identifiers, strict source-event, attachment,
agent-action, compaction-job, four-field segment, assembled-context, and
repository/dispatcher interfaces. Encode UTF-16 bounds and same-workspace
validation at public seams.

**Acceptance criteria:**

- Above-100,000 inbound text, malformed segment fields, mixed workspace scope,
  invalid levels/ranges, and over-limit attachment/job values are rejected.
- Contracts distinguish source evidence, outbound candidates, action outcomes,
  and ready segments; only `READY` segments are renderable.
- Existing family-map contracts are byte-for-byte unchanged.

**Likely files:**

- `packages/contracts/src/ids.ts`
- `packages/contracts/src/continuity.ts` (new)
- `packages/contracts/src/index.ts`
- `packages/contracts/tests/continuity.test.ts` (new)

**Verification:**

```bash
npm test --workspace @medbuddy/contracts -- --run continuity workspace-family-map
npm run typecheck
```

**Dependencies:** None.

### Task 2: Specify the shared source-ledger adapter contract

**Description:** Add reusable scenarios for atomic provider-event acceptance,
post-dedup sequence allocation, deterministic outbound publication, immutable
events, edits, unsends, attachment state, one active compaction job, and ready
segment publication.

**Acceptance criteria:**

- Concurrent duplicate acceptance yields one event and one sequence.
- Two workspaces can use identical fictional provider data without leakage.
- Invalid or stale candidate publication cannot enter ready history.

**Likely files:**

- `packages/contracts/tests/continuity-adapter-contract.ts` (new)
- `packages/contracts/tests/continuity-adapter-contract.test.ts` (new)
- `packages/contracts/src/continuity.ts`

**Verification:**

```bash
npm test --workspace @medbuddy/contracts -- --run continuity-adapter
```

**Dependencies:** Task 1.

### Task 3: Implement the in-memory continuity adapter

**Description:** Implement the source ledger, sequence counter, deduplication,
outbound candidates, attachment transitions, job single-flight state, and
immutable ready segments in the existing in-memory platform.

**Acceptance criteria:**

- The shared adapter contract passes without test-only policy branches.
- Writes serialize per workspace; unrelated workspaces remain independent.
- Failed and non-ready candidates are never returned by context queries.

**Likely files:**

- `packages/platform/src/in-memory/continuity.ts` (new)
- `packages/platform/src/in-memory/repositories.ts`
- `packages/platform/src/index.ts`
- `packages/platform/tests/continuity-in-memory.test.ts` (new)

**Verification:**

```bash
npm test --workspace @medbuddy/platform -- --run continuity-in-memory
```

**Dependencies:** Tasks 1–2.

### Checkpoint A: Contracts and deterministic persistence

```bash
npm test --workspace @medbuddy/contracts -- --run continuity
npm test --workspace @medbuddy/platform -- --run continuity-in-memory
npm run check
```

### Task 4: Build the effective projection and context assembler

**Description:** Implement latest-edit/tombstone projection, attributed
rendering, UTF-16 accounting, focal excerpts, pending-history markers,
10k/20k/30k selection, family-map/action blocks, and parent-or-descendant
historical frontier selection as one deep Chat module.

**Acceptance criteria:**

- Tests cover surrogate pairs, attribution/marker costs, whole-message
  boundaries, focal oversize, hard-ceiling gaps, and temporal render order.
- The newest recent window is contiguous: selection stops at the first older
  non-fitting turn rather than skipping it, and action wrappers plus separators
  count toward their cap.
- The joined system, family-map, actions, history, marker, and recent blocks are
  at most 40,000 UTF-16 units; the serialized conversational Vertex request is
  at most 60,000 units and reserves 2,048 output tokens.
- Edits and unsends change recent/future projection without modifying sources.
- Mixed workspaces, overlapping ranges, and parent/child duplication fail
  before Intelligence receives context.

**Likely files:**

- `packages/chat/src/conversation-continuity.ts` (new)
- `packages/chat/src/index.ts`
- `packages/chat/tests/conversation-continuity.test.ts` (new)
- `packages/contracts/src/continuity.ts`

**Verification:**

```bash
npm test --workspace @medbuddy/chat -- --run conversation-continuity
```

**Dependencies:** Tasks 1 and 3.

### Task 5: Implement compaction planning and publication policy

**Description:** Add deterministic level-1 range planning, ordered-source
digests, four-child higher-level merges, deterministic job identities, backlog
coalescing, validation, exact excerpt verification, and atomic publication
commands independent of provider transport.

**Acceptance criteria:**

- Level-1 ranges are disjoint and leave at most 10,000 recent units.
- Higher levels merge exactly four adjacent complete children through the same
  numbered-level path.
- Duplicate workers converge; stale projections, malformed summaries, and
  publication conflicts never overwrite a valid ready segment.
- Later edits and unsends targeting an unpublished range participate in its
  digest. Publication rejects stale candidates and replans from the corrected
  projection.
- Compaction input uses a marked deterministic 30,000-unit head/tail bound, so
  one accepted 100,000-unit source cannot poison a job.

**Likely files:**

- `packages/chat/src/compaction.ts` (new)
- `packages/chat/src/conversation-continuity.ts`
- `packages/chat/tests/compaction.test.ts` (new)
- `packages/contracts/src/continuity.ts`

**Verification:**

```bash
npm test --workspace @medbuddy/chat -- --run compaction conversation-continuity
```

**Dependencies:** Task 4.

### Task 6: Add deterministic summary generation at the Vertex seam

**Description:** Add the versioned four-field compaction prompt, strict output
parser, bounded fixed adapter, and direct Vertex generation path. Keep summary
generation separate from conversation/tool orchestration and configure the
target as `gemini-3.6-flash`.

**Acceptance criteria:**

- One provider call occurs per segment attempt; no critique/refinement loop.
- Output with extra top-level fields, invalid arrays, bad source references, or
  over-limit text is rejected.
- Health/medication statements are rendered as attributed reports and the
  provider receives no family-map, care-record, storage, or tool capability.
- Historical summaries never authorize family-map mutation. Deterministic
  focal-turn classification grants the capability only for an explicit current
  identity, relationship, correction, or forget/clear statement.
- A conservative structural allowlist grants the capability only to complete
  explicit identity, relationship, correction, or forget/clear forms.
  Interrogatives, uncertainty, and negation never grant it, including
  punctuation-free, fullwidth-punctuation, indirect English, and common CJK
  question forms.

**Likely files:**

- `packages/intelligence/src/conversation/compaction.ts` (new)
- `packages/intelligence/src/adapters/vertex.ts`
- `packages/intelligence/src/index.ts`
- `packages/intelligence/tests/compaction.test.ts` (new)
- `packages/intelligence/tests/vertex-adapter.test.ts`

**Verification:**

```bash
npm test --workspace @medbuddy/intelligence -- --run compaction vertex-adapter medication-refusal
```

**Dependencies:** Tasks 1 and 5.

### Checkpoint B: Pure continuity and model boundary

```bash
npm test --workspace @medbuddy/chat -- --run continuity compaction
npm test --workspace @medbuddy/intelligence -- --run compaction vertex medication-refusal
npm run check
```

### Task 7: Implement the Firestore continuity adapter

**Description:** Add workspace-scoped source, counter, candidate, attachment,
job, state, and segment persistence with atomic receipt/source acceptance and
atomic ready publication. Add only required composite indexes.

**Acceptance criteria:**

- The same adapter contract used by memory passes against the emulator.
- Transaction callbacks contain no external side effects and tolerate Firestore
  retries/contention.
- Query shapes cannot read a second workspace and expose only ready segments.

**Likely files:**

- `packages/platform/src/firestore/continuity.ts` (new)
- `packages/platform/src/firestore/repositories.ts`
- `packages/platform/src/index.ts`
- `packages/platform/tests/continuity-firestore.test.ts` (new)
- `firestore.indexes.json`

**Verification:**

```bash
npm test --workspace @medbuddy/platform -- --run continuity-firestore firestore-emulator
```

**Dependencies:** Tasks 1–3 and 5.

### Task 8: Add durable compaction dispatch and private execution

**Description:** Generalize the existing Cloud Tasks adapter for deterministic
continuity jobs, add OIDC-authenticated private task handling, enforce one
active job and three application attempts, and compose the worker into the
existing Cloud Run application.

**Acceptance criteria:**

- Duplicate enqueue returns success and uses the same task identity.
- Unauthorized callback, wrong audience/service account, invalid body, and an
  exhausted attempt produce only safe metadata.
- The worker atomically owns one model attempt, reuses a ready result before
  invoking Gemini, and claims/dispatches remaining backlog after publication.
- Concurrent deliveries cannot both call Gemini; failed jobs are reclaimable
  under the bounded-attempt policy.
- A running attempt holds a 60-second lease. One delivery can transactionally
  take over an expired lease, while unexpired duplicates remain model-free.
- Every attempt-owned release, failure, publication, and active-job clear uses
  the stored monotonic attempt generation as a transactional fence. The
  generation remains authoritative after requeue or terminal active-pointer
  clearance, so late owners cannot mutate a lease successor.
- Level-1 publication reloads and revalidates its mutation digest after Gemini,
  then atomically requires the observed source-sequence watermark.

**Likely files:**

- `packages/platform/src/cloud-tasks/dispatcher.ts`
- `packages/platform/tests/tasks-storage.test.ts`
- `apps/web/app/api/internal/continuity/route.ts` (new)
- `apps/web/src/composition/continuity.ts` (new)
- `apps/web/tests/continuity-task.test.ts` (new)

**Verification:**

```bash
npm test --workspace @medbuddy/platform -- --run tasks
npm test --workspace @medbuddy/web -- --run continuity-task
```

**Dependencies:** Tasks 5–7.

### Task 9: Replace count-based LINE conversation orchestration

**Description:** Split inbound observation, candidate generation, LINE
delivery, and accepted-outbound publication. Persist unmentioned group/room
text, support group `messageEdited` and all documented `unsend` events, and
assemble character-bounded context without changing the family-map module.

**Acceptance criteria:**

- Every valid supported text event persists; mentions control only whether a
  response candidate is generated. Text is accepted through 100,000 UTF-16
  units and rejected above that boundary without content logging.
- Group and legacy-room unsends remain observable when LINE omits the sender;
  conversation and target identity do not depend on `source.userId`.
- LINE rejection/timeout never publishes MedBuddy conversation evidence; LINE
  success publishes once through a deterministic idempotent operation.
- Existing family-map updates, final-acknowledgment semantics, replay behavior,
  DM/group parity, and deterministic medical refusal remain correct.

**Likely files:**

- `packages/chat/src/thread-conversation.ts`
- `packages/chat/tests/external-conversation.test.ts`
- `packages/contracts/src/external-conversation.ts`
- `apps/web/src/line/webhook.ts`
- `apps/web/tests/line-webhook.test.ts`

**Verification:**

```bash
npm test --workspace @medbuddy/chat -- --run external-conversation continuity
npm test --workspace @medbuddy/web -- --run line-webhook
npm test --workspace @medbuddy/intelligence -- --run medication-refusal conversation
```

**Dependencies:** Tasks 4, 7, and 8.

### Task 10: Add private LINE attachment ingestion

**Description:** Parse image/file source markers without content exposure,
dispatch durable downloads, stream at most 10 MiB, validate JPEG/PNG/WebP/PDF
signatures and checksums, store through the private workspace-scoped adapter,
and enforce `PENDING -> AVAILABLE|FAILED` with three total attempts.

**Acceptance criteria:**

- Unsupported media remains an attributed metadata-only source marker.
- Bucket/object names, URLs, provider IDs, filenames, bytes, and checksums never
  leave adapters or enter model context/logs.
- Storage or integrity failure never claims `AVAILABLE`; attachment bytes are
  never sent to Gemini.

**Likely files:**

- `packages/platform/src/storage/attachments.ts`
- `packages/platform/tests/tasks-storage.test.ts`
- `apps/web/src/line/content-client.ts` (new)
- `apps/web/src/line/webhook.ts`
- `apps/web/tests/line-attachment.test.ts` (new)

**Verification:**

```bash
npm test --workspace @medbuddy/platform -- --run tasks-storage attachment
npm test --workspace @medbuddy/web -- --run line-attachment line-webhook
```

**Dependencies:** Tasks 3, 7–9.

**Approved implementation discovery (2026-08-04):** LINE's content endpoint
requires the raw provider message ID, while the approved task/domain input is
opaque. The user approved an adapter-private encrypted locator record keyed by
opaque workspace and attachment IDs. AES-256-GCM binds that scope as
authenticated data; the versioned key is runtime-only. No raw provider ID or
locator ciphertext may cross into task payloads, domain contracts, source
events, logs, model context, or object references.

### Checkpoint C: End-to-end synthetic LINE path

```bash
npm test --workspace @medbuddy/web -- --run line continuity attachment
npm test --workspace @medbuddy/chat -- --run external-conversation continuity compaction
npm run check
```

### Task 11: Complete configuration and content-free observability

**Description:** Wire continuity/attachment task URLs, queue identity, model
selection, policy constants, safe logs/metrics, and production composition.
Update setup documentation without credentials or real content.

**Acceptance criteria:**

- Startup validates `gemini-3.6-flash` configuration and all required private
  task/storage settings without echoing values.
- Logs cover job/attempt/level/character/token/latency/backlog/omission/conflict
  metadata and reject prohibited or high-cardinality fields.
- Current conversation, family-map, local demo, and production composition tests
  remain green.

**Likely files:**

- `apps/web/src/composition/config.ts`
- `apps/web/src/composition/line.ts`
- `apps/web/src/line/runtime.ts`
- `apps/web/tests/composition/production-composition.test.ts`
- `docs/LINE_SETUP.md`

**Verification:**

```bash
npm test --workspace @medbuddy/web -- --run composition line telemetry
npm test --workspace @medbuddy/intelligence -- --run vertex-smoke
```

**Dependencies:** Tasks 6 and 8–10.

### Task 12: Full verification, privacy review, and handoff evidence

**Description:** Run every required automated gate, targeted security/privacy
searches, dependency audit triage, and a final diff review. Record exact commands
and residual accepted risks. Do not deploy, open a PR, or merge anything.

**Acceptance criteria:**

- Every acceptance criterion in the approved design has direct test or review
  evidence.
- No credentials, real identifiers/content, PII, health information, prompts,
  summaries, excerpts, object references, or secret values appear in changes or
  logs.
- Branch history consists of small logical commits and the worktree is clean.

**Likely files:**

- `tasks/todo.md`
- `docs/proposals/LONG_RUNNING_CONVERSATION_CONTINUITY_DESIGN.md` only if an
  implementation discovery requires an approved design correction
- focused tests required by discovered gaps

**Verification:**

```bash
npm run check
npm test
npm run build --workspace @medbuddy/web
npm audit --omit=dev
git diff --check origin/main...HEAD
```

**Dependencies:** Tasks 1–11.

## Verification matrix

| Requirement | Primary evidence |
| --- | --- |
| 100k admission and 10k/20k/30k rendering | Contract and Chat boundary tests |
| Post-dedup stable sequences | Shared adapter concurrency contract |
| Strict workspace isolation | Shared adapter, projection, context, task, and LINE integration tests |
| Outbound only after LINE acceptance | LINE failure/success integration tests |
| Single-flight, retries, atomic ready publication | Chat policy plus memory/Firestore adapter tests |
| Hierarchical parent-or-descendant selection | Chat compaction/frontier tests |
| Edit/unsend soft deletion | LINE and projection tests |
| Attachment lifecycle and privacy | Web/Platform task and storage tests |
| Content-free observability | Allowlisted logger/metric tests and staged diff review |
| Unchanged family map and medical refusal | Existing regression suites plus focused integration tests |
| `gemini-3.6-flash` boundary | Vertex request unit test and configuration-gated fictional smoke |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Large cross-package change | Contract-first dependency order, checkpoints, and small commits. |
| Firestore contention | One workspace counter/state transaction, emulator concurrency tests, no side effects in callbacks. |
| Reply accepted but publication fails | Deterministic candidate and bounded idempotent publication retry; never resend LINE. |
| Compaction lag/failure | 30k hard ceiling, pending marker, prior ready segments, durable retry. |
| Prompt injection in history | Delimiting and hard capability limits; accepted semantic-hardening deferral remains explicit. |
| Soft deletion retains old paraphrase | No segment regeneration; real-family-data gate remains closed. |
| Private attachment exposure | Opaque IDs, adapter-only object names, type/signature/size checks, no model input. |

## Approval gate

The user approved this plan and checklist. The coordinator must fetch `origin`,
verify its exact commit and required seams again, create a new clean
implementation worktree and `codex/` branch, and delegate the approved tasks to
one implementer subagent.
