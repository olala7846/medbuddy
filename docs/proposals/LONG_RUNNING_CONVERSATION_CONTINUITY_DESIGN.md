# Design: Long-Running Conversation Continuity

**Status:** Approved; implementation plan pending approval

**Date:** 2026-08-04

**Effort:** 2 of 3 — long-running conversation continuity

**Target baseline:** `origin/main` at `ee3b63b5ddb84d70dbba91b72ecef8bd8ef8daf1`, including the LINE conversational prototype and the implemented workspace family map

## 1. Objective and user value

Let one LINE group, legacy room, or DM continue indefinitely while each model call receives a bounded, attributed, useful history. The newest conversation remains exact where it fits; older conversation becomes immutable, source-linked, progressively diluted historical context.

Success means MedBuddy can continue a fictional long-running family conversation without crossing workspace boundaries, blocking a reply on compaction, treating a summary as medical authority, or losing the current focal message when history is large.

This design records only the Effort 2 delta. It relies on the accepted [LINE product direction](../../PRODUCT_DIRECTION.md), [LINE prototype specification](../LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md), [LINE ADR](../decisions/0002-line-first-conversational-prototype.md), and implemented [workspace family-map design](./WORKSPACE_FAMILY_MAP_DESIGN.md).

## 2. Scope and non-goals

### 2.1 In scope

- Workspace-scoped immutable source events with a canonical, monotonically increasing sequence.
- Persistence of every supported LINE group, room, or DM message; mentions control replies, not observation.
- Character-bounded recent context measured in UTF-16 code units after attribution and marker rendering.
- Immutable multi-resolution compaction segments over exact source-sequence ranges.
- Durable Cloud Tasks scheduling on the existing Cloud Run application.
- Deterministic context selection and ordering across safety, focal message, agent actions, the family map, historical segments, and recent conversation.
- LINE group text edits, LINE unsend events, attachment markers, and private asynchronous attachment ingestion.
- Firestore, Cloud Storage, Cloud Tasks, and in-memory test adapters.
- Content-free operational telemetry and fictional synthetic verification.

### 2.2 Non-goals

- Changing the family-map schema, 4,000-character bound, revision semantics, ownership, correction lifecycle, or `update_workspace_family_map` authority.
- Promoting messages or summaries into the family map or reviewed care record.
- General retrieval, vector search, semantic ranking, deterministic event lookup, or cross-workspace identity.
- A generalized multi-tool agent runtime, new medical tools, diagnoses, prescriptions, or autonomous medication decisions.
- Parsing, summarizing, or sending attachments to Gemini.
- Automatic retention expiry, complete derived-data erasure, a workspace wipe workflow, or regeneration of published segments after later edits or deletion.
- New summary-specific prompt-injection defenses. This is an accepted prototype risk, not a relaxation of deterministic authorization.
- More infrastructure than the existing modular monolith and its managed GCP products.

## 3. Reconciliation with Effort 1

The implemented family-map design on the target baseline resolves the stale handoff mismatch: its status is now **Approved and implemented**, and PR #78 is merged. No Effort 1 artifact needs editing.

Effort 2 preserves these interfaces and invariants:

1. `WorkspaceId` and `MemberId` remain the opaque isolation boundary for groups, rooms, and DMs.
2. Context assembly accepts an optional bounded rendered family-map block. Compaction never imports or knows the Firestore family-map shape.
3. The family map remains a current 4,000-character, revision-checked document updated only through `update_workspace_family_map`.
4. Family-map tool outcomes enter a separate bounded agent-action block. They are neither recent conversation nor compaction input.
5. Budget allocation and render order are separate. The family map retains its place before conversation history even though protected recent content has higher budget priority.
6. Historical segments render before newer attributed source evidence.
7. The current `messages: max 20` interface becomes a character-based assembled-context interface. The family-map module is unchanged.
8. A committed map update remains canonical if final LINE delivery fails. A MedBuddy response becomes conversation evidence only after LINE accepts it.
9. Deterministic diagnosis, prescribing, and medication-decision refusal still runs against the focal inbound event before any model call and never consults summaries.

## 4. Domain vocabulary

| Term | Meaning |
| --- | --- |
| Source event | Immutable, attributed workspace evidence assigned a canonical workspace-local source sequence after deduplication. |
| Provider provenance | Opaque provider-derived message/event references and provider time. It supports linkage and audit but never defines canonical order. |
| Effective conversation projection | The deterministic latest, non-tombstoned, user-visible representation of source events at an assembly or compaction boundary. |
| Recent verbatim window | Newest eligible complete projected turns rendered exactly with attribution, except a clearly labeled bounded focal excerpt. |
| Agent-action context | Bounded typed tool/system outcomes supplied separately to the model and excluded from conversation compaction. |
| Compaction segment | Immutable derived summary plus a trusted deterministic envelope over one exact inclusive source range. |
| Compaction level | Positive integer resolution. Level 1 summarizes source events; level N+1 summarizes adjacent complete level N segments. |
| Segment frontier | Non-overlapping ready segments selected so a parent or its descendants appear, never both. |
| Pending-history marker | Small deterministic notice replacing an omitted uncompacted gap at the hard ceiling. It contains no conversation content. |
| Outbound candidate | Generated MedBuddy text awaiting LINE acceptance. It is not a source event and never enters context. |
| Reviewed care fact | Separately governed medical information. Compaction cannot create, update, or override it. |

## 5. Global invariants

1. Every repository read, write, query, job, object, digest, cache key, and context contract is explicitly scoped to one `WorkspaceId`.
2. Deduplication precedes source-sequence allocation. Duplicate provider delivery returns the existing accepted result and consumes no new sequence.
3. Source sequences are positive, workspace-local, and never reused. Provider timestamps do not reorder them.
4. Accepted inbound source events qualify immediately. Generated MedBuddy text qualifies only after LINE returns success.
5. User-visible projected turns alone enter recent conversation and level-1 compaction. Agent actions and attachment bytes never do.
6. Published segment ranges are immutable. Level-1 ranges are ordered and disjoint; higher levels merge only adjacent complete child segments.
7. The four-field summary is untrusted derived data. The segment envelope is deterministic trusted metadata.
8. Only an atomically published `READY` segment is selectable. Malformed, partial, stale, failed, or generating output is not rendered.
9. A newer attributed source event always renders after older historical segments; summary text never overrides newer evidence.
10. Compaction failure never blocks or fabricates the current reply.
11. No raw LINE identifier, content, prompt, summary, excerpt, attachment metadata, object reference, or credential enters operational logs or metric labels.
12. All repository fixtures, examples, evaluations, and smoke content are fictional and anonymous.

## 6. Contracts

The exact TypeScript names may be refined in the approved implementation plan. The interface shapes and invariants are normative.

### 6.1 Source event

```ts
type SourceEvent = {
  id: SourceEventId;
  workspaceId: WorkspaceId;
  sourceSequence: number;
  occurredAt: string;       // provider provenance only
  acceptedAt: string;
  providerMessageId?: MessageId; // already opaque and workspace-scoped
  authorMemberId: MemberId | "MEDBUDDY";
  payload:
    | { kind: "TEXT"; body: string; replyRequested: boolean }
    | { kind: "TEXT_EDIT"; targetMessageId: MessageId; body: string }
    | { kind: "UNSEND"; targetMessageId: MessageId }
    | { kind: "ATTACHMENT"; attachmentId: AttachmentId; mediaClass: "IMAGE" | "PDF" | "OTHER" };
};
```

- `body` admits at most 100,000 UTF-16 code units. Above-bound events are rejected before persistence with content-free telemetry.
- The signed webhook keeps its independent 1 MiB request-body guard.
- LINE message and edit event IDs map to the same opaque `MessageId`; the webhook event maps to a distinct source-event deduplication identity.
- LINE currently sends group-only `messageEdited` events and sends `unsend` events for DMs, groups, and rooms. The adapter validates only documented shapes.
- `replyRequested` is true for DM text and explicit bot mentions in groups/rooms. It does not control persistence.

The source ledger is canonical for continuity. To avoid changing the Effort 1
family-map module, accepted inbound and LINE-accepted outbound text also update
the existing `MessageRepository` compatibility projection in the same
transaction. Its current `revision` remains application mutation metadata and
is never used as the compaction coordinate; `sourceSequence` is authoritative.
The existing message text bound expands to the same 100,000 UTF-16-unit
admission bound, while model rendering remains governed by the much smaller
context limits. Edits, unsends, and attachment lifecycle events remain source
ledger concepts; continuity never reads the compatibility projection as
history and prior source events are never mutated.

### 6.2 Effective projection

The source ledger remains immutable. A deterministic projection groups text and edit events by opaque `providerMessageId`, applies the latest edit by source sequence, and removes any target with a later unsend event. Attachment events render only an attributed availability marker; bytes, filenames, object paths, and URLs never enter the projection.

An edit or unsend that arrives while an unpublished level-1 job covers its target changes the projection digest. Publication rejects that stale candidate and retries from the new projection. Once a segment is `READY`, later edits or unsends never rewrite it. The newer correction remains temporally later evidence; a prior summary may retain a paraphrase as the accepted soft-deletion risk.

### 6.3 Attachment record and private storage seam

```ts
type ContinuityAttachment = {
  id: AttachmentId;
  workspaceId: WorkspaceId;
  sourceEventId: SourceEventId;
  mediaClass: "IMAGE" | "PDF" | "OTHER";
  state: "PENDING" | "AVAILABLE" | "FAILED";
  byteSize?: number;
  checksum?: string;
  attempts: number; // 0..3
};

interface PrivateAttachmentStore {
  saveValidated(input: {
    workspaceId: WorkspaceId;
    attachmentId: AttachmentId;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
    bytes: Uint8Array;
    checksum: string;
  }): Promise<void>;
}
```

- Source events expose only the opaque attachment ID and media class.
- The storage adapter alone derives the bucket and workspace-prefixed object name.
- JPEG, PNG, WebP, and PDF are downloadable, with a 10 MiB maximum after streaming byte-count and content-signature validation.
- All other LINE attachment types become `OTHER` metadata-only markers and are never downloaded.
- Download is a durable Cloud Task. Three total attempts include the first. `AVAILABLE` is written only after storage and integrity checks succeed; exhausted work becomes `FAILED` and the source event remains.

### 6.4 Agent-action context

```ts
type AgentActionContext = {
  workspaceId: WorkspaceId;
  items: readonly {
    sourceEventId: SourceEventId;
    kind: "WORKSPACE_FAMILY_MAP_UPDATE" | "SYSTEM_OUTCOME";
    outcome: unknown; // parsed by a kind-specific bounded schema
  }[];
};
```

The context assembler receives already authorized, typed outcomes through this interface. It validates same-workspace references and applies a 4,000 UTF-16-unit rendered cap, newest relevant items first. Effort 2 adds no general action repository or tool runtime.

### 6.5 Segment summary and envelope

```ts
type SegmentSummary = {
  overview: string;
  keyEvents: Array<{
    text: string;
    attribution?: string;
    sourceSequence?: number;
    verbatimExcerpt?: { text: string; sourceSequence: number };
  }>;
  openLoops: string[];
  caveats: string[];
};

type CompactionSegment = {
  id: CompactionSegmentId;
  workspaceId: WorkspaceId;
  level: number;
  firstSourceSequence: number;
  lastSourceSequence: number;
  sourceCount: number;
  orderedSourceDigest: string;
  childSegmentIds: CompactionSegmentId[];
  modelId: string;
  promptVersion: string;
  policyVersion: string;
  createdAt: string;
  inputCharacters: number;
  outputCharacters: number;
  status: "READY";
  summary: SegmentSummary;
};
```

The schema has exactly four derived top-level fields. All strings, array lengths, nesting, total output characters, and optional excerpt size are bounded. Initial configuration uses a 4,000 UTF-16-unit total summary cap, at most 12 key events, 8 open loops, 8 caveats, and one optional excerpt of at most 300 units. These are versioned constants, not an optimization subsystem.

An optional excerpt is accepted only when deterministic code finds an exact byte-for-byte UTF-16 string match in the referenced projected source event. It remains delimited untrusted quoted data and is excluded from higher-level output unless separately revalidated against a retained source.

## 7. Character admission and recent-window behavior

All thresholds count JavaScript string `.length` over the fully rendered attributed conversation block. Labels, separators, excerpt labels, attachment/unavailable markers, and the pending-history marker count toward the same bound.

| Threshold | Required behavior |
| --- | --- |
| 100,000 per inbound text | Reject above-bound source text without content logging or a special LINE notice. |
| 10,000 protected recent | Select the newest complete projected turns up to this rendered bound before optional family/history allocation. |
| Above 20,000 uncompacted recent | Durably schedule asynchronous level-1 compaction. Continue replying. |
| 30,000 model-request ceiling | Never render more verbatim conversation. Omit oldest uncompacted complete turns and insert one pending-history marker. |
| 40,000 assembled-context ceiling | Bound the fully joined system, family-map, agent-action, historical, marker, and recent blocks, including every separator. |
| 60,000 serialized conversation-request ceiling | Bound the complete Vertex request including prompts, envelopes, declarations, and JSON wrappers. Reserve output with `maxOutputTokens: 2048`. |
| After level-1 publication | Cover enough oldest complete events that remaining recent conversation is at most 10,000; whole-message boundaries may undershoot. |

The focal text is always protected. If its attributed rendering alone cannot fit the focal allocation, retain the complete accepted source in storage and render a deterministic head/tail excerpt with `BEGIN BOUNDED EXCERPT — NOT VERBATIM MESSAGE` and an omission count. No other ordinary message is split.

## 8. Deterministic context assembly

### 8.1 Budget priority

Allocation proceeds in this order:

1. System, safety, and trust-boundary instructions.
2. Current focal message or its marked bounded excerpt, plus reserved response capacity.
3. Relevant bounded agent-action outcomes.
4. Up to 10,000 units of newest eligible recent conversation.
5. Optional current Effort 1 family-map block, bounded by its existing contract.
6. A non-overlapping multi-resolution historical frontier.
7. Additional contiguous recent conversation toward 20,000, or 30,000 while compaction is pending.

Token estimates and observed provider token usage are telemetry only. Configuration reserves a provider-specific maximum output and a fixed total request ceiling; character selection remains the primary deterministic boundary.

### 8.2 Render order

Selected blocks render in this order, regardless of allocation priority:

1. System, safety, trust, and tool instructions.
2. Workspace family map, when present.
3. Agent-action outcomes, clearly delimited as untrusted typed outcomes.
4. Historical compaction segments, oldest to newest and clearly labeled derived/non-authoritative.
5. Pending-history marker, if needed.
6. Attributed recent projected turns in source order, with the focal turn last when it is the newest event.

The focal turn is never duplicated. Segment ranges and recent source ranges cannot overlap. Every selected segment belongs to the workspace. Parent/descendant overlap is rejected by schema validation before Intelligence receives context.

### 8.3 Selection pseudocode

```text
assemble(workspace, focal, familyMap?, actions, requestBudget):
  assert every input is workspace-scoped
  projected = effectiveProjection(sourceEvents after latest READY L1 coverage)
  protect system + focal/excerpt + response reserve
  actionsBlock = newest relevant actions fitting 4k
  recent = newest whole projected turns fitting 10k
  familyBlock = include current bounded map if remaining budget permits
  history = chooseNewestReadyFrontier(before recent.firstSequence, remaining budget)
  expand recent backward contiguously toward 20k, stopping at the first non-fitting turn
  if compaction is pending and budget remains, expand toward 30k
  if older uncompacted projected turns remain:
    prepend one pending-history marker inside the 30k conversation ceiling
  validate no cross-workspace, range overlap, parent/child overlap, assembled-context breach, or serialized-provider-request breach
  render family, actions, history, marker, recent in temporal order
```

## 9. Multi-resolution compaction

### 9.1 Level 1

When uncompacted projected conversation crosses 20,000 units, choose the oldest inclusive source range ending at the largest complete event boundary that leaves at most 10,000 units recent. The range may contain non-rendered technical source events; `sourceCount` counts the immutable events, while the model input contains only their effective user-visible projection.

The ordered-source digest hashes policy version plus canonical workspace-scoped event IDs, source sequences, event kinds, attribution, projection status, and content digests. A level-1 digest also includes any later edit or unsend targeting a message inside the unpublished range. Publication recomputes that mutation-aware digest; a mismatch fails the stale job before model work and schedules a new digest-scoped job. It never appears in metrics and reveals no content.

Level-1 model input is capped at 30,000 UTF-16 units. If a complete projected
range is larger, deterministic code renders a marked head/tail compaction
excerpt with an exact omission count. This permits a single accepted
100,000-unit turn to compact without changing or truncating its immutable
source evidence.

### 9.2 Higher levels

Initial `mergeFanIn` is 4. When four adjacent complete ready segments at level N have no gap and no existing ready parent, one level N+1 job summarizes their four-field summaries. One generic segment implementation handles every numbered level. Children remain stored for provenance, but context chooses the parent or descendants, never both.

Higher-level prompts increasingly preserve activity, key events, open loops, corrections, uncertainty, attribution, and safety caveats while dropping greetings, repetition, resolved mechanics, exact phrasing, and lower-level excerpts. Participant health and medication statements remain attributed reports, never facts.

### 9.3 Fictional worked example

Fictional workspace `workspace:orchard` has source sequences 1–180. At sequence 125, effective attributed recent text reaches 21,400 units. The coordinator creates level-1 job `[1, 72]`; its ready segment leaves sequences 73–125 rendered at 9,700 units. Conversation continues while the job runs, so any request may temporarily render more than 20,000 but never more than 30,000.

Later, ready level-1 segments cover `[1,72]`, `[73,141]`, `[142,208]`, and `[209,276]`. One level-2 job merges those exact adjacent children into `[1,276]`. The children remain queryable for provenance. Context renders either the level-2 parent or the four level-1 children. If sequence 280 edits a message originally at sequence 250 after the parent is published, the parent is not rebuilt; the newer attributed correction appears after it.

## 10. Storage and adapters

### 10.1 Firestore

```text
externalEventReceipts/{receiptKey}
workspaces/{workspaceId}/platformCounters/sourceEvents
workspaces/{workspaceId}/sourceEvents/{sourceEventId}
workspaces/{workspaceId}/outboundCandidates/{candidateId}
workspaces/{workspaceId}/continuityState/compaction
workspaces/{workspaceId}/compactionJobs/{jobId}
workspaces/{workspaceId}/compactionSegments/{segmentId}
workspaces/{workspaceId}/attachments/{attachmentId}
```

- One transaction claims a provider event, allocates the next source sequence, and creates the inbound source event. A duplicate returns the prior result.
- `continuityState/compaction` contains only scheduler state and the one active job reference, never summary content.
- A transaction changes one `PENDING` job to `RUNNING` and increments its
  attempt before Gemini is called. Concurrent task deliveries observe `RUNNING`
  and perform no model work. A failed job may be explicitly reclaimed as a new
  bounded attempt cycle when no job is active.
- Segment IDs and job IDs derive from workspace, level, inclusive range,
  compaction-policy version, and the level-1 projection digest.
- An outbound candidate is stored outside source history. On LINE success, an idempotent transaction allocates a source sequence and publishes the MedBuddy text source event; rejection or timeout leaves no conversation evidence.
- Query indexes are limited to workspace subcollections ordered by `sourceSequence`, segment `level/firstSourceSequence`, and job status. No vector or cross-workspace index is added.

### 10.2 Cloud Storage

The adapter derives an internal object name under a workspace-scoped prefix from opaque IDs. Bucket names and object names never cross the adapter interface. Upload uses the validated MIME type and checksum; context exposes only the attachment ID, media class, and state marker.
The worker also enforces the accepted media class before storage: `IMAGE`
allows only the supported image MIME types and `PDF` allows only
`application/pdf`. A mismatch consumes a bounded attempt and never writes the
downloaded bytes.

LINE content retrieval uses a separately approved adapter-private locator. The
webhook adapter encrypts the raw LINE provider message ID with AES-256-GCM under
a runtime-only versioned key and stores the ciphertext keyed by the opaque
workspace and attachment IDs. The authenticated encryption binds that opaque
scope as additional authenticated data. Only the LINE content adapter may
decrypt the locator immediately before calling LINE's fixed content endpoint.
Raw provider IDs and locator ciphertext never enter source events, domain
contracts, Cloud Tasks payloads, logs, model context, or Cloud Storage object
references. Missing, malformed, cross-workspace, or undecryptable locators fail
the attachment attempt without exposing their values. Keys come only from
runtime configuration and are never logged or committed.

### 10.3 Cloud Tasks and Cloud Run

- Deterministic task names make duplicate enqueue attempts converge.
- OIDC-authenticated HTTP tasks call private routes on the existing Cloud Run application.
- The handler validates audience and service-account identity before parsing job input.
- Compaction and attachment work each cap application attempts at three; exhausted jobs return success to stop further queue retries and retain explicit failed state.
- One task attempt makes at most one Gemini segment call. A retry first reuses an existing valid ready result.
- No promise is started after the webhook response without a durable task.

### 10.4 In-memory adapter

The in-memory adapter implements the same repository interfaces, transaction semantics, per-workspace sequence serialization, deduplication, single-flight state, candidate publication, edit/tombstone projection, and attachment transitions. Shared contract tests run against both adapters; Firestore emulator tests cover transaction contention and indexes.

## 11. Scheduling, idempotency, validation, and publication

1. After each accepted source event, calculate the effective rendered backlog using repository metadata and attempt an atomic scheduler claim.
2. Below or equal to 20,000, no task is needed. Above 20,000, create or reuse the deterministic level-1 job and set it as the workspace's sole active compaction job.
3. Enqueue the deterministic Cloud Task. Enqueue failure does not fail the reply; the durable scheduler state lets the next request or operator retry dispatch.
4. The worker reloads the job, projection, and digest. If a valid `READY` segment already exists, reuse it and finish without Gemini.
5. Invoke Gemini once with a versioned prompt and schema.
6. Validate the four-field output, all bounds, source references, optional excerpt exactness, workspace/range envelope, and current projection digest.
7. In one transaction, create the immutable `READY` segment if absent, advance coverage, release the active job, and record whether more backlog or a higher-level merge is eligible.
8. Competing workers converge on the first valid immutable segment. A publication conflict reloads and accepts the existing valid result; it never overwrites it.
9. Coalesced backlog schedules the next deterministic job after the current job clears.

Firestore may rerun transaction callbacks after contention, so callbacks perform no model, LINE, Cloud Storage, logging, or task-dispatch side effects.

## 12. Failure and fallback behavior

| Failure | Behavior |
| --- | --- |
| Compaction delayed or queue unavailable | Reply from bounded recent context and existing ready segments; retry durable scheduling later. |
| Recent uncompacted history reaches 30,000 | Omit oldest complete turns, keep them in storage, and render one pending-history marker. |
| Gemini timeout/error/malformed summary | Publish nothing, retain prior ready segments, increment safe attempt metadata, and retry the same range within bounds. Failed work may be explicitly reclaimed under a fresh bounded attempt cycle. |
| Projection changes before publication | Reject the stale candidate before model work and dispatch a digest-scoped replacement from the current edit/tombstone-aware projection. |
| Duplicate task/worker | Atomically grant one `PENDING`-to-`RUNNING` attempt; concurrent deliveries perform no Gemini call, then reuse ready output or converge through immutable publication. |
| Ready publication leaves eligible backlog | Atomically claim and dispatch the next level-1 or higher-level job; at most one workspace job remains active. |
| LINE rejects or times out | Do not publish the outbound candidate as a source event. Committed family-map updates remain canonical. |
| LINE accepts but source publication transiently fails | Retry the deterministic idempotent publication within the request; record content-free failure metadata if exhausted. Never send LINE twice. |
| Attachment retrieval or validation fails three times | Mark attachment `FAILED`; retain the attributed unavailable marker and never claim it was stored. |
| No family map or no historical segments | Continue with the remaining valid blocks; neither is required for a reply. |

## 13. Edits, tombstones, deletion, and retention

- A LINE group `messageEdited` webhook appends a new immutable `TEXT_EDIT` source event linked through the original opaque message ID. DMs and legacy rooms do not receive edit events under the current LINE contract.
- An `unsend` webhook appends `UNSEND`. For documented group and legacy-room
  unsends where LINE omits `source.userId`, the conversation scope and target
  message ID are derived from the group/room and unsent message IDs; a
  deterministic system actor supplies attribution without inventing a sender.
  The effective projection removes the target text from recent context and
  future level-1 inputs.
- Existing ready segments are never invalidated or regenerated. They may retain a paraphrase of content later edited or unsent.
- An unsent attachment is removed from recent/future projection, but its private
  bytes are not automatically erased in Effort 2. Attachment state or deletion
  never causes raw bytes to enter context.
- Source events, outbound candidates, segments, and available attachments have no automatic retention expiry in Effort 2.
- This soft deletion is not complete erasure of derived data. It is documented as an accepted prototype risk, and the real-family-data gate remains closed.

## 14. Security, isolation, and medical safety

### 14.1 Trust boundaries

- Signed LINE webhook bytes, provider responses, downloaded files, Cloud Task requests, Firestore records, model output, family-map content, historical summaries, and recent messages are all validated at their seams.
- Model output is data only. Deterministic code selects jobs, validates schemas and excerpts, controls publication, binds workspace scope, and owns all retries and permissions.
- The model receives no Firestore, Cloud Storage, queue, repository, workspace-selection, family-map, or care-record capability beyond the existing turn-bound typed family-map tool.

### 14.2 Threats and controls

| Threat | Control |
| --- | --- |
| Cross-workspace disclosure | Workspace is an application-bound key on every contract; repository queries and context validation reject mixed scope; tests exercise similar fictional content in two workspaces. |
| Replay or sequence ambiguity | Transactional receipt claim and source allocation; provider time is never ordering authority. |
| Oversized text/file denial of service | Independent request, text, attachment, model-context, output, retry, and timeout bounds. |
| Malicious attachment | Allowlisted MIME plus signature validation, streaming byte cap, private storage, no model parsing, no public URL. |
| Summary causes an action | Summaries are delimited untrusted context and cannot grant tools or write canonical state. Deterministic code grants the family-map capability only when the current attributed focal turn contains an explicit identity, relationship statement, correction, or forget/clear request; a model-emitted call without that focal grant is rejected before the repository. |
| Medical statement becomes authoritative | Summaries label statements as attributed reports; deterministic refusal and reviewed-care authority never consume them. |
| Sensitive telemetry | Allowlisted content-free log schemas and tests reject unexpected fields. |

Prompt injection in recent or compacted text remains possible and is explicitly deferred. Delimiting and least privilege reduce impact but are not represented as a complete defense.

## 15. Observability and cost controls

Structured logs and basic counters, gauges, and latency distributions record only safe metadata:

- job lifecycle, level, attempt count, duplicate, validation failure, and publication conflict;
- input/output character counts and provider-reported token usage;
- queue, execution, and staleness duration classes;
- uncompacted backlog size class and hard-ceiling omission count;
- attachment state/attempt/result classes;
- model ID, prompt version, and policy version from an allowlist;
- safe request/job correlation tokens.

Metrics never label by workspace or another high-cardinality tenant identifier. Logs never include message bodies, summaries, excerpts, prompts, model output, attachment metadata, object references, raw or opaque LINE/member/workspace identifiers, reply tokens, or credentials.

Cost is bounded by one Gemini call per segment attempt, one active job per workspace, merge fan-in 4, no critique loop, at most three application attempts, deterministic duplicate reuse, and no attachment model calls.

## 16. Test-driven verification strategy

All automated fixtures are fictional and synthetic. Implementation starts with failing contract and behavior tests for:

- UTF-16 admission at 100,000 and fully rendered 10,000/20,000/30,000 boundaries, including surrogate pairs and attribution labels;
- stable post-dedup source sequences under duplicate and concurrent delivery;
- persistence without reply for unmentioned group messages;
- MedBuddy publication only after accepted LINE replies;
- effective edit and tombstone projection, including a stale in-flight candidate;
- exact disjoint ranges, ordered digests, single-flight scheduling, deterministic job identity, and backlog coalescing;
- four-field validation, excerpt source verification, immutable ready publication, duplicate convergence, and retry reuse;
- parent-or-descendant frontier selection and no range overlap;
- hard-ceiling omission marker and marked focal excerpt;
- identical repository behavior in memory and Firestore emulator;
- attachment allowlist, 10 MiB cap, checksum, private object-name seam, three attempts, and state transitions;
- content-free logs and low-cardinality metric labels;
- strict cross-workspace isolation at ledger, job, segment, attachment, family-map, action, and assembled-context seams;
- unchanged deterministic medical refusal before model invocation.

Required project gates remain:

```bash
npm run check
npm test
npm run build --workspace @medbuddy/web
```

After those and privacy review pass, a separately authorized fictional deployed LINE smoke sends enough anonymous text to cross 20,000 units and verifies durable dispatch, atomic ready publication, recent reduction to at most 10,000, strict isolation, and content-free logs. Deployment is not authorized by this design.

## 17. Acceptance criteria

1. Every supported LINE DM/group/room message is deduplicated and persisted in its workspace, whether or not MedBuddy replies.
2. Accepted inbound text supports 100,000 UTF-16 units while the webhook retains an independent request-size limit.
3. Recent rendering follows the 10,000 protected, 20,000 trigger, and 30,000 hard-ceiling rules exactly.
4. The focal message is always represented; an oversized focal message is clearly labeled as an excerpt and remains complete in storage.
5. Source sequences are stable, monotonically increasing, and allocated only after deduplication.
6. A MedBuddy reply becomes source evidence only after LINE accepts it.
7. Level-1 ranges are disjoint; higher levels merge only adjacent complete children; a selected parent never coexists with descendants.
8. Only validated atomically published ready segments enter context, and retries reuse an existing valid result.
9. Context order is family map, agent actions, historical segments, then newer attributed evidence after system/safety instructions.
10. The family-map module, authority, 4,000-character contract, and revision behavior are unchanged.
11. Compaction never writes the family map or reviewed care record and never influences deterministic medical refusal.
12. Compaction, attachment, model, queue, and storage failure never block or fabricate the current reply.
13. Edits and unsends affect recent/future projection without rewriting ready segments; the soft-deletion limitation is documented.
14. Supported attachments are private, bounded, integrity-checked, and never parsed or sent to Gemini.
15. Cross-workspace isolation and metadata-only telemetry tests pass with fictional fixtures.
16. The required check, test, and build commands pass.

## 18. Explicit Effort 3 deferrals

- Exact quote lookup and deterministic source-event lookup.
- Keyword, tag, participant, subject, time, and trust-class retrieval.
- Vector embeddings, semantic similarity, hybrid ranking, and cross-thread identity.
- Reviewed-care retrieval and a generalized multi-tool runtime.
- Model-graded or live-content continuity evaluation.

## 19. Model decision

The user selected `gemini-3.6-flash` as the Effort 2 target and confirmed that it
is the current model to use. The existing direct Vertex boundary remains
configuration-driven rather than embedding model selection in continuity
policy. Contract tests use deterministic fakes; a configuration-gated smoke
must verify `gemini-3.6-flash` in the target project and region before the
fictional deployed continuity smoke.

## 20. References

- [Workspace family-map design](./WORKSPACE_FAMILY_MAP_DESIGN.md)
- [Agent memory proposal](./AGENT_MEMORY_ARCHITECTURE.md), consulted only where not superseded
- [LINE webhook reception, edits, unsend, and redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [LINE Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/)
- [Vertex function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling)
- [Firestore transactions and atomic writes](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Cloud Tasks HTTP targets](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks)
- [Cloud Tasks retry configuration](https://docs.cloud.google.com/tasks/docs/configure-retry-task)
