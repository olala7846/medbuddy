# Design: Workspace Family Map

**Status:** Approved and implemented

**Date:** 2026-08-04

**Effort:** 1 of 3 — workspace family map
**Target baseline:** The LINE-first conversational prototype with explicit authorization in [PR #78](https://github.com/olala7846/medbuddy/pull/78)

## Purpose and scope

MedBuddy uses one small, raw-text family map in each isolated LINE group, legacy room, or DM workspace. The map lets the agent understand explicit family references, such as “Mom,” without creating a general profile or medical-record system. A workspace person can be an observed LINE participant or an explicitly named relative who never sends a LINE message.

The agent can replace the map with one bounded tool. A participant can state, correct, inspect, forget, or clear direct relationships in normal conversation. After a successful update, MedBuddy acknowledges the change and can use it on later turns. A DM follows the same model as a group: it is a workspace containing the user and MedBuddy.

The map is limited to one current, human-readable document per workspace. It contains direct, explicitly stated family relationships and non-clinical caregiver relationships. It has no medical authority.

### Included behavior

- Discover human members when they send verified messages.
- Store workspace-local names for observed participants and named relatives.
- Store only direct, explicitly stated relationships; derive indirect relationships only for the response.
- Use these headings, in this order, for every non-empty map: `Participants`, `Named relatives`, and `Direct relationships`. Keep empty headings when needed.
- Let every observed participant add, correct, replace, or clear the shared map. The latest successful explicit correction wins.
- Render the bounded map into each model turn. Allow one successful update and one final LINE text reply per inbound message.
- Enforce a 4,000-character complete replacement, workspace-scoped revisions, and identical Firestore and in-memory behavior.
- Produce metadata-only operational events and use fictional evaluation fixtures.

### Excluded behavior

- General profiles, arbitrary long-term memory, health facts, diagnoses, medication instructions or changes, treatment changes, and medical authority.
- Persisting inferred relationships, all derived edges, unnamed or vague people, model-invented people, LINE roster/profile calls, or identity across workspaces or channels.
- Private memory, administrators, voting, conflict resolution, a relationship schema or ontology, deterministic relationship traversal, history, audit text, undo, UI, slash commands, or agent file access.
- A generalized multi-tool runtime, multiple outbound messages, rolling summaries or compaction (Effort 2), retrieval (Effort 3), or new prompt-injection/semantic-validation infrastructure.

## Terms and product rules

| Term | Meaning |
| --- | --- |
| Workspace | One LINE group, legacy room, or DM. It isolates messages, members, and the map. |
| Workspace person | An explicitly identified observed participant or named relative in one workspace. |
| Observed participant | A human sender from an accepted signed LINE event, bound to an opaque workspace member ID. |
| Named relative | An explicitly named workspace person without a LINE participant identity in this workspace. |
| Family map | The one current, bounded, human-readable raw-text document of workspace people and direct relationships. |
| Direct / derived relationship | A direct relationship is explicitly stated. A derived relationship can guide a response but is never persisted. |
| Explicit update | An unambiguous statement, correction, or forget request that permits an immediate write. |
| Revision | A workspace-local compare-and-set integer. It is concurrency metadata, not retained content history. |
| Source event | The attributed message that caused the tool call. It remains conversation evidence and is not copied into the map. |
| Reviewed care fact | Separately governed medical information. It is authoritative only in the care record and never comes from this map. |

The map is shared semantic memory. Raw messages remain source events; recent messages are working context; reviewed care facts remain separately authoritative.

1. A clear direct statement authorizes an update. Corrections apply without another confirmation.
2. A successful update receives a visible acknowledgment. Failures and conflicts never receive a false saved claim.
3. The map cannot grant permissions, clinical authority, or authority over reviewed care facts.
4. The same LINE user in two conversations has unrelated opaque member identities and maps.
5. A named relative can be stored before they send a LINE message.
6. A join event or greeting never links a participant to a named relative. Only attributed identity evidence or a uniquely resolving direct-relationship statement can link them. Ask for clarification when the match is ambiguous.

For example, a map can say that Mei is Kai’s mother and Lin is Mei’s mother. The agent can call Lin Kai’s grandmother in a response, but it must not store that derived relationship. It can inspect the supplied map without a read tool, remove one relationship, or clear the complete map with empty replacement content. Clearing leaves no old map text in family-map storage.

When a pronoun can identify more than one workspace person, the agent asks which person the user means and does not write. This is clarification, not a second permission prompt. Before model invocation, a narrow deterministic guard also catches explicit relationship sentences whose target is only a third-person pronoun when multiple observed participants are possible.

The update capability uses a conservative deterministic structural allowlist on the attributed turn. It accepts complete explicit identity, direct-relationship, correction, and forget/clear forms. Questions, uncertainty such as “I wonder if,” and negation do not qualify, even without question punctuation. A structurally complete correction such as “Correction: Mei is Kai’s mother, not his sister” is the negation exception. Identity introduction requires `my name is`, `call me`, or retained capitalized `I am Mei`; `I am tired` does not qualify. Specific `forget that …` and `forget everything in our family map` forms authorize removal.

## Architecture and contracts

```text
verified LINE event
  -> opaque workspace/member/message IDs
  -> Chat persists the focal message
  -> ContextAssembler loads recent messages + current map
  -> bounded ConversationAgent loop
       -> final text, or update_workspace_family_map
       -> bound family-map capability -> Firestore/in-memory adapter
       -> typed tool result -> final text
  -> Chat persists the MedBuddy message -> LINE sends one reply
```

`@medbuddy/contracts` owns Zod schemas, branded values, outcomes, and public interfaces. `@medbuddy/chat` assembles context, orchestrates messages, and binds server-owned workspace, actor, source message, and timestamp metadata. `@medbuddy/intelligence` renders prompts, declares and parses Vertex functions, and owns the bounded loop. It receives a narrow tool capability, never a repository or Firestore client. `@medbuddy/platform` owns Firestore and in-memory persistence invariants. `@medbuddy/web` composes modules and keeps raw LINE identifiers and reply tokens in the transport adapter. No new package, database, worker, or framework is required.

```ts
type WorkspaceFamilyMap = {
  workspaceId: WorkspaceId;
  content: string;
  revision: number;
  updatedAt?: string;
  updatedByMemberId?: MemberId;
  sourceMessageId?: MessageId;
};

type ReplaceWorkspaceFamilyMapInput = {
  workspaceId: WorkspaceId;
  actorMemberId: MemberId;
  sourceMessageId: MessageId;
  expectedRevision: number;
  content: string;
  updatedAt: string;
};

type ReplaceWorkspaceFamilyMapResult =
  | { kind: "UPDATED"; familyMap: WorkspaceFamilyMap }
  | { kind: "NO_CHANGE"; familyMap: WorkspaceFamilyMap }
  | { kind: "REVISION_CONFLICT"; familyMap: WorkspaceFamilyMap }
  | { kind: "REJECTED"; code: "CONTENT_TOO_LARGE" | "INVALID_SOURCE" }
  | { kind: "TECHNICAL_FAILURE"; retryable: boolean };

interface WorkspaceFamilyMapModule {
  get(workspaceId: WorkspaceId): Promise<WorkspaceFamilyMap>;
  replace(input: ReplaceWorkspaceFamilyMapInput): Promise<ReplaceWorkspaceFamilyMapResult>;
}

interface UpdateWorkspaceFamilyMapTool {
  update(input: { expectedRevision: number; content: string }): Promise<ReplaceWorkspaceFamilyMapResult>;
}
```

The module validates that the actor and source message belong to the workspace. The model never supplies `workspaceId`, `actorMemberId`, `sourceMessageId`, or `updatedAt`. The model-visible tool is only `update_workspace_family_map`, with non-negative `expectedRevision` and complete `content`. Its description restricts entries to explicit workspace people and direct family/non-clinical caregiver relationships, requires preservation of still-correct entries and the three headings, permits empty content to clear, requires opaque participant IDs byte-for-byte, and states the 4,000-character limit. Vertex receives only its documented OpenAPI subset; the application enforces the revision and size limits.

The provider uses an application-controlled Vertex `AUTO` function-calling loop: the model proposes a typed call, the application validates and executes it, returns the result, then accepts final text. See [Vertex function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling). The provider seam distinguishes final text from a function call; it does not use arbitrary JSON. The public result remains:

```ts
type ConversationAgentResult =
  | { kind: "RESPONDED"; responseText: string; toolCalls: number }
  | { kind: "REFUSED_MEDICAL_ADVICE"; responseText: string; toolCalls: 0 }
  | { kind: "REFUSED_MEDICATION_DECISION"; responseText: string; toolCalls: 0 }
  | { kind: "TECHNICAL_FAILURE"; retryable: boolean; toolCalls: number };
```

## Context, storage, and state

```ts
type ConversationContext = {
  workspaceId: WorkspaceId;
  messages: Message[]; // existing bound: at most 20
  familyMap: { content: string; revision: number };
};
```

Before Intelligence receives context, every message and the map must belong to `workspaceId`. Content is normalized for newlines and outer trimming, then limited to 4,000 Unicode code points. Raw LINE identifiers never enter the contract or context. Every human message includes its opaque `authorMemberId`.

The prompt order is deterministic medical-safety instructions, tool rules including explicit-update and one-successful-write limits, a delimited map with its revision and raw text, then bounded attributed recent messages from the same workspace. The map is conversational context only. It is not input to medication refusal, authorization, care-record review, or future medical-decision policy. Participant lines carry opaque IDs; other lines remain readable and can use the workspace language.

Firestore stores one document at `workspaces/{workspaceId}/workspaceMemory/familyMap`:

```ts
type WorkspaceFamilyMapDocument = {
  workspaceId: WorkspaceId;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedByMemberId: MemberId;
  sourceMessageId: MessageId;
};
```

Absence reads as empty content at revision 0. The first non-empty replacement creates revision 1. A clear stores empty content at the next revision. The document is overwritten in place, needs no secondary index, and retains only the last updater and source-message references; the message remains the source event. The in-memory adapter uses the same workspace key, normalization, compare-and-set, outcomes, and contract tests.

In one Firestore transaction, `replace` reads the current document; returns `NO_CHANGE` when normalized content is identical, even with a stale revision; returns `REVISION_CONFLICT` with the current map when different content has a stale revision; validates bound actor and source; then overwrites with revision plus one and returns `UPDATED`. Transaction callbacks must not log, call models, or create other side effects because Firestore can rerun them. See [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).

```text
ABSENT (revision 0, empty) -- non-empty at revision 0 --> CURRENT revision 1
CURRENT N -- different at revision N --> CURRENT N+1
CURRENT N -- empty at revision N --> CLEARED N+1
any state -- identical content at any revision --> NO_CHANGE
any state -- different content at stale revision --> REVISION_CONFLICT; no write
CLEARED N -- non-empty at revision N --> CURRENT N+1
CLEARED N -- empty --> NO_CHANGE
```

There are no candidate, promoted, rejected, superseded-content, expired, or historical states. A correction is a successful replacement.

## Agent loop and failures

1. Run deterministic diagnosis, prescribing, and medication-decision refusal before the model.
2. Assemble one workspace context and call the model with the tool in `AUTO` mode.
3. Validate final text and finish, or validate and execute one tool call.
4. Return the typed result. For `REJECTED` or `TECHNICAL_FAILURE`, disable tools, make one bounded continuation call, discard its acknowledgment text, and render the application-owned failure acknowledgment.
5. After `REVISION_CONFLICT`, accept final text or one retry built from the returned current map. After one successful update, disable the tool and require final text.
6. Stop on final text or the overall deadline.

Limits: one successful update, at most two attempts (the second only after a revision conflict), one final outbound LINE message, and one overall 25-second turn deadline. Each model or tool step receives only remaining time. Individual provider timeouts cannot consume the full deadline. Unexpected tool names, malformed arguments, extra successful calls, missing final text, or loop exhaustion return `TECHNICAL_FAILURE`. A broader loop with multiple tools, parallel/sequential calls, multiple messages, or model-selected completion is deferred.

| Condition | Required result |
| --- | --- |
| Duplicate LINE webhook | The receipt claim prevents another model turn, map update, persisted message, or reply. |
| Duplicate identical tool call | `NO_CHANGE`; no revision increase. |
| Stale, different replacement | `REVISION_CONFLICT`; no write; one retry may use the current map. |
| Oversized content / invalid source | `REJECTED/CONTENT_TOO_LARGE` or `REJECTED/INVALID_SOURCE`; no write; invalid source logs a metadata-only security event; render the deterministic failure acknowledgment. |
| Firestore failure | `TECHNICAL_FAILURE`; do not claim success; render the failure acknowledgment after the bounded continuation. |
| Model failure before / after update | Before: no write or fabricated answer. After: keep the committed update, fail the webhook, and invent no reply. |
| LINE reply failure or crash after update | Keep the committed update. At-most-once receipts prevent duplicate replies; a visible acknowledgment can be lost after a crash. |

The update and LINE reply are intentionally not one distributed transaction.

## Trust, privacy, observability, and verification

LINE bodies are untrusted until signature verification and strict parsing. The adapter transforms LINE identifiers; raw values never cross into Chat, Intelligence, persistence, prompts, or logs. Messages and map text are untrusted model context. Tool names and arguments are untrusted until schema validation. Only the injected map module reaches Firestore. The tool has server-bound workspace, actor, and source scope. The model has no repository, credentials, or general storage handle. Model output is bounded and validated before persistence or reply.

Application-bound workspace IDs prevent cross-workspace access. Opaque workspace-scoped identities prevent raw-ID disclosure. Equal participant update authority is intentional; visible acknowledgments let another participant correct an update, and updates grant no authority. The map never becomes a medical source. Tool descriptions and evaluations limit it to names and direct relationships; semantic enforcement is deferred and is a known prototype limitation. Prompt-injection hardening is also deferred; delimiting, least privilege, loop limits, and deterministic safety remain. The system prompt is not a security boundary.

Tests, examples, screenshots, and smoke evidence use fictional people and identifiers. Never commit or diagnose with real identifiers, relationships, conversation text, health information, credentials, map text, prompts, outputs, or runtime content. Do not copy runtime content to issues, pull requests, traces, or external observability.

Allowed events are `family_map_tool_requested`, `family_map_updated`, `family_map_no_change`, `family_map_revision_conflict`, `family_map_rejected`, `family_map_failed`, `conversation_tool_loop_completed`, and `conversation_tool_loop_exhausted`. Allowed fields are correlation ID, conversation type, outcome, safe error code, revisions, character-count class, tool attempts, model steps, and duration class. Do not log workspace, member, message, LINE, or reply-token IDs; map/message/prompt/output/tool content; credentials; health facts; or embeddings.

Implementation uses test-driven development after this design and a separate implementation plan are approved. Small tests cover contracts; Unicode-aware size and normalization; absent, replacement, clear, and no-history behavior; idempotency; conflicts; workspace-bound source validation and context; attributed prompts; named nonparticipants; the required headings; deterministic medical refusal without model/tool use; malformed output and arguments; and the one-successful-update limit. Run shared repository contracts against in-memory and Firestore/emulator adapters for creation, replacement, clearing, idempotency, contention, missing sources, and isolation.

Use a deterministic provider for contracts and configuration-gated Vertex evaluations for: explicit updates; no write for inference; correction preservation; conversational but unpersisted indirect relations; ambiguity; inspect; forget; clear; truthful success/failure acknowledgments; conflict retry preservation; medication or prompt-control attempts as known evaluation gaps; fictional multilingual naming of two nonparticipating children; sibling inference without a stored sibling edge; and safe name-only identity linkage. End-to-end fictional tests cover signed group flow, later use, isolation for similar names, the equivalent DM path, concurrent updates, webhook replay, each model/tool/Firestore/LINE failure above, and metadata-only logs.

Acceptance requires a fictional named nonparticipant relationship to update exactly once and receive an acknowledgment; later correct relative interpretation by another participant; only direct persisted edges; immediate correction, inspect, and forget; isolated but equivalent group/DM behavior; model-inaccessible scope fields; oversized-write rejection; no silent concurrent loss; only the current map after clearing; unchanged deterministic medical refusal; no sensitive repository or log data; readable three-section Firestore text; and sibling responses from two named sons with a shared parent but no stored sibling edge. Run:

```bash
npm run check
npm test
npm run build --workspace @medbuddy/web
```

For fictional smoke, run automated and configuration-gated checks, then deploy only after implementation approval. In a disposable LINE group, verify create, inspect, correct, derived-reference use, forget, and clear; repeat create/use/clear in a DM; inspect Firestore for separation and one current document; and review metadata-only logs. This validates mechanics only. It does not merge PR #78, authorize production rollout, or broaden medical safety.

## Boundaries, decisions, and references

Keep workspace scope at every seam, validate calls and provider results, run deterministic medical refusal before the model, protect raw identifiers and content, and test through public interfaces and shared contracts. Ask before adding tools, successful updates, messages, schemas or semantic validation, LINE profile calls, cross-workspace identity, unnamed people, private memory, retention/rollout/medical-policy changes, dependencies, databases, queues, workers, or frameworks. Never let the model provide scope, access a repository, or edit files; treat the map as medical information; diagnose, prescribe, or change medication; or copy map/conversation content into telemetry, fixtures, issues, pull requests, or commits.

The implementation keeps the direct Vertex REST adapter and existing package boundaries. It adds no dependency or infrastructure product. Fictional deployed smoke uses `gemini-2.5-flash`; its retirement remains in [`LINE_SETUP.md`](../LINE_SETUP.md) and needs separately tested replacement.

Effort 2 may add bounded recency-weighted conversation continuity with untrusted derived summaries. Effort 3 may add deterministic query filters over promoted workspace memory, reviewed care facts, and attributed evidence, then vector retrieval only after a measured gap. A later runtime may add multiple tools/calls/messages and stronger prompt-injection controls. These additions must not expose repositories or weaken workspace isolation.

- [PR #78: LINE-first conversational prototype](https://github.com/olala7846/medbuddy/pull/78)
- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) and [`LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md`](../LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md)
- [`AGENT_MEMORY_ARCHITECTURE.md`](./AGENT_MEMORY_ARCHITECTURE.md)
- [Vertex AI function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling)
- [Firestore transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [LINE webhook reception and redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [LINE Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/)
