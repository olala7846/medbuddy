# Design: Workspace Family Map

**Status:** Approved and implemented

**Date:** 2026-08-04

**Effort:** 1 of 3 — workspace family map

**Target baseline:** The LINE-first conversational prototype merged with explicit authorization in [PR #78](https://github.com/olala7846/medbuddy/pull/78)

## 1. Objective

Make MedBuddy understand how explicitly identified people in one LINE conversation are related so it can use natural family references such as “Mom” and “Grandpa” instead of repeatedly saying “the patient.” People may be chat participants or named relatives who never send a LINE message.

Each LINE group, legacy room, or DM remains one isolated workspace. A DM uses the same model as a group: it is a workspace containing the user and MedBuddy. The first implementation stores one small, raw-text family map per workspace and gives the conversational agent one bounded tool that can replace that map.

Success means a participant can state or correct a direct relationship in ordinary conversation, see MedBuddy acknowledge the saved change, and have later turns interpret relative family terms using the updated map.

## 2. Scope

### 2.1 In scope

- One current family map for each workspace.
- Lazy discovery of human members when they send messages.
- Workspace-local names for observed participants and explicitly named relatives.
- Direct, explicitly stated family relationships between workspace people, including nonparticipating relatives.
- A consistent human-readable raw-text organization for participants, named relatives, and direct relationships.
- A non-clinical caregiver relationship, which conveys context but no medical authority.
- Natural-language inspection, addition, correction, and forgetting.
- Equal update authority for every human member of the workspace.
- A single model-visible `update_workspace_family_map` tool.
- Complete replacement of a maximum 4,000-character raw-text map.
- Revision-checked, workspace-scoped persistence in Firestore and an equivalent in-memory adapter.
- Bounded rendering of the map into every model turn.
- At most one successful family-map update per inbound message.
- One final LINE text reply after the model finishes the bounded tool loop.
- Metadata-only operational events and fictional evaluation fixtures.

### 2.2 Non-goals

- A general personal profile or arbitrary long-term memory.
- Health observations, diagnoses, medication facts or instructions, treatment changes, or claims of medical authority.
- Automatically persisting inferred or indirect relationships.
- Storing every derived relationship such as both `parent` and `grandparent` edges.
- Unnamed, vaguely referenced, or model-invented people.
- LINE roster or profile API calls.
- Identity linkage between workspaces or channels.
- Participant-private memory, administrators, voting, or conflict resolution.
- Structured relationship schemas, kinship ontologies, or deterministic relationship traversal.
- Version history, audit history containing old map text, or undo.
- A separate settings UI, slash commands, or agent file access.
- A generalized multi-tool agent runtime or multiple outbound messages.
- Rolling summaries and long-running conversation compaction (Effort 2).
- Queryable memory and retrieval tools (Effort 3).
- New prompt-injection classification or semantic-validation infrastructure.

## 3. Domain vocabulary

| Term | Meaning |
| --- | --- |
| Workspace | Exactly one LINE group, legacy room, or DM. It is the isolation boundary for messages, members, and the family map. |
| Workspace person | A person explicitly identified in this workspace, either as an observed participant or a named relative. |
| Observed participant | A human sender whose signed LINE event has been accepted and converted into an opaque member ID in this workspace. |
| Named relative | An explicitly named workspace person who has no LINE participant identity in this workspace. |
| Workspace family map | The one current, bounded, human-readable raw-text document describing workspace people and their direct relationships. |
| Direct relationship | A relationship explicitly stated between two workspace people, such as “Mei is Kai’s mother.” |
| Derived relationship | A relationship inferred from direct relationships, such as concluding that Lin is Kai’s grandmother. It may guide a response but is not persisted. |
| Explicit update | An unambiguous statement, correction, or forget request that authorizes an immediate family-map write without another confirmation. |
| Family-map revision | A workspace-local integer used for compare-and-set replacement. It is concurrency metadata, not retained content history. |
| Source event | The attributed message that caused the tool call. It remains conversation evidence and is not copied into the family map automatically. |
| Reviewed care fact | Separately governed medical information. It is authoritative within the care record and never comes from the family map. |

The workspace family map is a narrow form of shared semantic memory. Raw messages remain source events; recent messages remain working context; reviewed care facts remain a separate authoritative record.

## 4. Product rules

1. An inferred relationship may affect the current conversational response but must not be persisted.
2. An unambiguous explicit relationship statement is sufficient authorization to update the map.
3. A direct correction applies immediately; MedBuddy does not ask for another confirmation.
4. After a successful write, MedBuddy visibly acknowledges what it will use in this workspace.
5. Any observed participant may add, correct, clear, or replace the shared map.
6. The latest successfully applied explicit correction wins.
7. Only direct relationships are stored. The model derives relative terms at response time.
8. The map never grants permissions, clinical authority, or authority over reviewed care facts.
9. A tool failure or conflict must never produce a false claim that the map was saved.
10. The same external LINE user in two conversations has unrelated workspace-scoped member identities and unrelated family maps.
11. An explicitly named relative does not need to send a LINE message before MedBuddy can remember them.
12. A join event or greeting alone never links a participant identity to a named relative. An attributed identity or uniquely resolving direct-relationship statement may link them; ambiguous matches require clarification.

## 5. User-visible scenarios

All people and identifiers below are fictional.

### 5.1 Establish a direct relationship

```text
member_a: I’m Mei. Kai is my son.
MedBuddy: Okay—I’ll remember that Mei is Kai’s mother in this chat.
```

Kai may be a named relative who has never sent a LINE message. The agent replaces the complete family map once. It does not store any further derived relationship.

### 5.2 Use relative language

Given this map:

```text
Participants
- Mei (member_a)

Named relatives
- Kai
- Lin

Direct relationships
- Mei is Kai's mother.
- Lin is Mei's mother.
```

When Kai says “Mom,” the model can interpret the reference as Mei. When Mei says “Mom,” it can interpret the reference as Lin. The model may infer that Lin is Kai’s grandmother for the response, but it does not write that derived relationship.

### 5.3 Correct the map

```text
member_b: Lin is Mei’s mother, not her sister.
MedBuddy: Okay—I’ll remember that Lin is Mei’s mother in this chat.
```

The agent reads the current map, removes the incorrect line in its replacement text, adds the corrected line, calls the tool, and acknowledges only after `UPDATED`.

### 5.4 Inspect the map

```text
member_c: What do you remember about our family?
MedBuddy: I currently have: Mei is Kai’s mother, and Lin is Mei’s mother.
```

The current map is already in context, so inspection requires no read tool.

### 5.5 Forget one relationship

```text
member_a: Forget that Lin is Mei’s mother.
MedBuddy: Okay—I removed that relationship from this chat’s family map.
```

### 5.6 Clear the map

```text
member_a: Forget everything in our family map.
MedBuddy: Okay—I cleared the family map for this chat.
```

Empty replacement content represents a cleared map. No old family-map text remains in family-map storage.

### 5.7 Ask for clarification instead of guessing

If “she” could identify more than one workspace person, the agent asks which person the user means and does not call the tool. This is target clarification, not a second permission prompt.

The implementation also applies a narrow deterministic guard before model
invocation for an explicit relationship sentence whose target is only a
third-person pronoun while multiple observed participants are possible. This keeps
the clarification/no-write invariant even when the model would otherwise
invent a member mapping.

## 6. Module and seam design

The family map is a deep capability whose public boundary is owned by the
shared contracts. Chat binds the current workspace, actor, and source message;
Intelligence owns the bounded model/tool loop; Platform enforces persistence
invariants and storage. Callers still learn only the small workspace-scoped
interface rather than repository or vendor details.

```text
verified LINE event
  -> opaque workspace/member/message IDs
  -> Chat persists the focal message
  -> ContextAssembler loads recent messages + current family map
  -> bounded ConversationAgent loop
       -> final text, or
       -> update_workspace_family_map
            -> bound WorkspaceFamilyMap capability
            -> Firestore/in-memory adapter
       -> tool result returned to model
       -> final text
  -> Chat persists the MedBuddy message
  -> LINE adapter sends one reply
```

### 6.1 Ownership

| Module | Responsibility |
| --- | --- |
| `@medbuddy/contracts` | Zod schemas, branded values, discriminated outcomes, and public module interfaces. |
| `@medbuddy/chat` | Workspace context assembly, message orchestration, and the turn-bound update capability that supplies server-owned workspace, actor, source-message, and timestamp metadata. |
| `@medbuddy/intelligence` | Prompt rendering, Vertex function declarations, model-step parsing, the bounded model/tool/model loop, and the one-successful-update-per-turn limit. It receives a narrow tool capability, never a repository or Firestore client. |
| `@medbuddy/platform` | Firestore and in-memory repository adapters that normalize content and enforce source validation, compare-and-set revisions, idempotency, and durable state transitions. It owns no conversational or medical policy. |
| `@medbuddy/web` | Composition and existing LINE transport behavior. Raw LINE identifiers and reply tokens stay adapter-local. |

No new package, database, background worker, or framework is required.

### 6.2 External family-map interface

Illustrative TypeScript contracts follow. Exact naming is reviewed again in the implementation plan.

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
```

The module validates that the actor and source message belong to the requested workspace. The model never supplies `workspaceId`, `actorMemberId`, `sourceMessageId`, or `updatedAt`.

### 6.3 Turn-bound model tool

Chat binds verified turn metadata and exposes this smaller capability to the conversation agent:

```ts
interface UpdateWorkspaceFamilyMapTool {
  update(input: {
    expectedRevision: number;
    content: string;
  }): Promise<ReplaceWorkspaceFamilyMapResult>;
}
```

The only model-visible declaration is conceptually:

```json
{
  "name": "update_workspace_family_map",
  "description": "Replace the complete human-readable family map for this chat after an explicit name, direct relationship, correction, or forget statement. Store explicitly named workspace people, including named relatives who are not LINE participants, and only explicit direct family or non-clinical caregiver relationships. Preserve all still-correct entries and use the required Participants, Named relatives, and Direct relationships headings.",
  "parameters": {
    "type": "object",
    "properties": {
      "expectedRevision": {
        "type": "integer",
        "description": "The non-negative revision supplied with the current family map."
      },
      "content": {
        "type": "string",
        "description": "The complete replacement family map, or an empty string to clear it. Copy opaque participant IDs byte-for-byte. Application validation rejects content over 4,000 characters."
      }
    },
    "required": ["expectedRevision", "content"]
  }
}
```

The provider declaration uses only the subset of OpenAPI fields documented by Vertex. The application contract separately enforces a non-negative revision and the 4,000-character maximum; provider schema hints are not a validation boundary.

Vertex function calling follows an application-controlled loop: the model proposes a typed call, the application validates and executes it, and the result is sent back to the model before final text is accepted. This matches Google’s documented function-calling flow and uses the default `AUTO` selection mode. See [Vertex AI function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling).

### 6.4 Conversation-agent result

Effort 1 preserves one outbound LINE text message:

```ts
type ConversationAgentResult =
  | { kind: "RESPONDED"; responseText: string; toolCalls: number }
  | { kind: "REFUSED_MEDICAL_ADVICE"; responseText: string; toolCalls: 0 }
  | { kind: "REFUSED_MEDICATION_DECISION"; responseText: string; toolCalls: 0 }
  | { kind: "TECHNICAL_FAILURE"; retryable: boolean; toolCalls: number };
```

The provider-facing internal seam should distinguish a final response from a function call rather than representing both as arbitrary JSON. This leaves room for a later general agent loop without exposing that future surface to Chat now.

## 7. Context assembly and rendering

`ConversationContext` expands from recent messages alone to include the current family map:

```ts
type ConversationContext = {
  workspaceId: WorkspaceId;
  messages: Message[]; // existing bound: at most 20
  familyMap: {
    content: string;
    revision: number;
  };
};
```

Every context invariant is checked before Intelligence receives it:

- Every message belongs to `workspaceId`.
- The family map was loaded using that same `workspaceId`.
- `content` is no more than 4,000 Unicode code points after newline normalization and outer trimming.
- Raw LINE identifiers never appear in the map contract or model context.
- Each human message is rendered with its opaque `authorMemberId`; otherwise the model cannot distinguish speakers or connect map entries to messages.

Prompt ordering is:

1. Deterministic MedBuddy role and medical-safety instructions.
2. Tool-use rules, including explicit-update and one-successful-write limits.
3. A delimited workspace family-map section containing its revision and raw text.
4. Bounded attributed recent messages from exactly the same workspace.

Example section:

```text
BEGIN WORKSPACE FAMILY MAP (revision 3; user-maintained context)
Participants
- Mei (member:line-fictional-a)

Named relatives
- Kai
- Lin

Direct relationships
- Mei is Kai's mother.
- Lin is Mei's mother.
END WORKSPACE FAMILY MAP
```

Every non-empty replacement uses the three headings in that order, retaining
empty sections when necessary. Participant lines carry exact opaque IDs;
named-relative and relationship lines remain readable. Relationship prose may
follow the language used in the workspace conversation.

The map is conversational context only. It is never consulted by deterministic medication refusal, authorization, care-record review, or any future medical-decision policy.

## 8. Persistence design

### 8.1 Firestore shape

Use one current document:

```text
workspaces/{workspaceId}/workspaceMemory/familyMap
```

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

- Document absence reads as `{ content: "", revision: 0 }`.
- First non-empty replacement creates revision 1.
- A clear operation stores empty content at the next revision rather than retaining old text.
- The document is overwritten in place. No history subcollection is created.
- No secondary index is required.
- The existing message remains the source event; family-map storage records only the last updater and source-message references.

### 8.2 In-memory adapter

The in-memory adapter keys the same document contract by `workspaceId` and implements the same compare-and-set, normalization, and outcome semantics. Repository contract tests run unchanged against both adapters.

### 8.3 Compare-and-set transaction

`replace` runs in one Firestore transaction:

1. Read the current family-map document.
2. If normalized replacement content equals current content, return `NO_CHANGE`, even if the supplied revision is stale. This makes duplicate identical calls idempotent.
3. If `expectedRevision` differs from the current revision, write nothing and return `REVISION_CONFLICT` with the current same-workspace map.
4. Validate the bound actor and source message against the workspace.
5. Overwrite the document with `revision + 1` and return `UPDATED`.

Firestore can rerun transaction functions after contention, so the transaction callback must contain no logging, model calls, or other side effects. See [Firestore transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions).

## 9. State transitions

```text
ABSENT (virtual revision 0, empty)
  -- non-empty replacement at expected revision 0 --> CURRENT revision 1

CURRENT revision N
  -- different replacement at expected revision N --> CURRENT revision N+1
  -- empty replacement at expected revision N -----> CLEARED revision N+1
  -- identical replacement at any revision --------> NO_CHANGE at revision N
  -- different replacement at stale revision ------> REVISION_CONFLICT; no write

CLEARED revision N
  -- non-empty replacement at expected revision N --> CURRENT revision N+1
  -- empty replacement -----------------------------> NO_CHANGE
```

There are no candidate, promoted, rejected, superseded-content, expired, or historical states in Effort 1. A correction is simply a successful replacement of the current raw text.

## 10. Bounded agent loop

The PR #78 baseline conversation provider performed one model call and explicitly prohibited tools. Effort 1 replaced that internal behavior with this bounded sequence:

1. Run deterministic diagnosis, prescribing, and medication-decision refusal before model invocation.
2. Assemble one workspace-scoped context.
3. Call the model with the family-map tool available in `AUTO` mode.
4. If the model returns final text, validate and finish.
5. If the model calls `update_workspace_family_map`, validate arguments and execute the bound tool.
6. Return the typed tool result to the model.
   For `REJECTED` or `TECHNICAL_FAILURE`, disable further calls and make one
   bounded continuation call, then discard model-authored acknowledgment text
   and render the application-owned failure acknowledgment.
7. Accept either final text or, after a `REVISION_CONFLICT`, one retry call built from the returned current map.
8. After one successful update, disable further family-map calls for this inbound message and require final text.
9. Stop on the final response or the overall turn deadline.

Limits:

- At most one successful update per inbound message.
- At most two update attempts, where the second exists only to recover from a revision conflict.
- At most one final outbound LINE text message.
- A single overall turn deadline is divided across model steps; individual provider timeouts must not independently consume the entire request deadline.
- Unexpected tool names, malformed arguments, extra successful calls, missing final text, or loop exhaustion produce `TECHNICAL_FAILURE`.

The general future loop—multiple tools, parallel or sequential tool calls, several outbound messages, and model-chosen completion—is a deliberate seam, not part of this implementation.

## 11. Failure, retry, and idempotency behavior

| Failure | Required behavior |
| --- | --- |
| Duplicate LINE webhook | Existing receipt claim prevents another model turn, map update, persisted message, or reply. |
| Duplicate identical tool call | `NO_CHANGE`; no revision increment. |
| Stale revision with different content | `REVISION_CONFLICT`; no write. The model may retry once using the current map. |
| Oversized content | `REJECTED/CONTENT_TOO_LARGE`; no write; return the typed result to the model, then render the deterministic application-owned failure acknowledgment. |
| Invalid bound source | `REJECTED/INVALID_SOURCE`; no write and a metadata-only security event; render the deterministic failure acknowledgment. |
| Firestore failure | `TECHNICAL_FAILURE`; no claim that the relationship was saved; render the deterministic failure acknowledgment after the bounded continuation step. |
| Model failure before update | No map write and no fabricated answer. |
| Model failure after update | The update remains committed; do not roll it back. The webhook completes as failed and no false reply is invented. |
| LINE reply failure after update | The update remains committed. Existing at-most-once receipt behavior prevents a duplicate reply. |
| Process crash after update | The update remains committed; a visible acknowledgment may be lost. This is accepted for the prototype. |

The persisted update and the outbound LINE reply are intentionally not one distributed transaction.

## 12. Trust, safety, and privacy boundaries

### 12.1 Trust boundaries

- LINE request bodies are untrusted until signature verification and strict parsing succeed.
- LINE-provided identifiers are transformed in the adapter; raw values do not cross into Chat, Intelligence, persistence, prompts, or logs.
- User messages and the family-map text are untrusted model context.
- Model-selected tool names and arguments are untrusted until schema validation succeeds.
- Firestore is reachable only through the injected family-map module; the model receives no repository, credentials, or general storage handle.
- Tool scope is server-bound to the current workspace, actor, and source message.
- Model output is validated as bounded text before persistence or reply.

### 12.2 Threats and controls

| Threat | Effort 1 control |
| --- | --- |
| Cross-workspace read or write | Workspace ID is bound by application code; every context and repository contract checks scope; no model-provided workspace parameter exists. |
| Raw LINE identifier disclosure | Continue PR #78’s opaque, workspace-scoped identity derivation; never log or persist raw identifiers. |
| Member impersonation inside a group | Every observed participant has equal update authority by product decision; updates are visibly acknowledged so another participant can correct them. No update grants additional authority. |
| Incorrect participant/name-only linking | A join event or greeting cannot link identity. Only attributed identity or uniquely resolving direct-relationship evidence may link one participant to one named relative; ambiguous matches require clarification. |
| Model writes medical content into the map | Tool description and evaluations restrict content to names and direct relationships; the map is never a medical source or input to deterministic medical policy. A semantic enforcement layer is deferred and this remains a known prototype limitation. |
| Prompt injection stored in raw text | New semantic prompt-injection hardening is explicitly deferred. Basic delimiting, least-privilege tool scope, loop limits, and deterministic safety remain. |
| Unbounded cost or loop | 4,000-character map cap, bounded recent messages, bounded tool attempts, one successful update, one final message, and an overall deadline. |
| Sensitive-content logging | Operational telemetry contains no map text, message text, prompts, outputs, raw or opaque member IDs, or tool arguments. |

The system prompt is not treated as a security boundary. Hard guarantees come from signature verification, server-bound scope, schema validation, repository isolation, tool limits, and deterministic medical routing.

### 12.3 Public repository hygiene

- Tests, examples, screenshots, and smoke evidence use fictional people and identifiers.
- Never commit credentials, real LINE identifiers, real family relationships, real conversation content, or health information.
- Never print those values while diagnosing the feature.
- Runtime content is not copied into issues, pull requests, model traces, or external observability systems.

## 13. Observability

Allowed metadata-only events include:

- `family_map_tool_requested`
- `family_map_updated`
- `family_map_no_change`
- `family_map_revision_conflict`
- `family_map_rejected`
- `family_map_failed`
- `conversation_tool_loop_completed`
- `conversation_tool_loop_exhausted`

Allowed fields are correlation ID, conversation type, outcome, safe error code, prior and resulting revision numbers, character-count class, tool-attempt count, model-step count, and duration class.

Prohibited fields include workspace/member/message identifiers, family-map content, message bodies, prompt text, tool arguments, model output, LINE identifiers, reply tokens, credentials, health facts, and embeddings.

## 14. Testing strategy

Implementation follows test-driven development after both this design and a separate implementation plan are approved.

### 14.1 Small tests

- Contract validation for map content, revision, and discriminated results.
- Unicode-aware 4,000-character boundary and newline normalization.
- Absent-map read behavior.
- Complete replacement, clear, and no-history behavior.
- Identical duplicate update returns `NO_CHANGE` without revision growth.
- Stale different update returns `REVISION_CONFLICT` without mutation.
- Source member and source message must belong to the workspace.
- Context rejects a map or message from another workspace.
- Prompt rendering attributes every human message with its opaque member ID.
- Prompt rendering permits explicitly named nonparticipants while prohibiting invented people and vague identity links.
- Every non-empty replacement uses the readable Participants, Named relatives, and Direct relationships organization.
- Deterministic medical refusals run without model or tool invocation.
- Model output and tool arguments are rejected when malformed.
- Loop stops after one successful update.

### 14.2 Shared adapter contract tests

Run the same family-map repository scenarios against:

- the in-memory adapter; and
- the Firestore adapter or emulator-backed implementation.

The contract covers creation, replacement, clearing, idempotency, contention, missing source messages, and strict workspace isolation.

### 14.3 Synthetic model evaluations

Use a deterministic provider for contract tests and configuration-gated Vertex evaluations for model behavior:

1. An explicit direct relationship produces one complete-replacement call.
2. An inferred relationship produces no persistence call.
3. A correction preserves unrelated lines and replaces the incorrect direct relationship.
4. An indirect relationship is used conversationally but is not added to the map.
5. An ambiguous reference asks a clarification question without writing.
6. Inspection answers from the supplied map without a read tool.
7. Forgetting one relationship removes only that relationship.
8. Clearing uses empty content.
9. A successful update produces a truthful acknowledgment.
10. A rejected or failed update never produces a success acknowledgment.
11. A conflict retry incorporates the current map rather than erasing another update.
12. Attempts to store medication instructions or prompt-control text do not influence deterministic medical safety; failures are recorded as known evaluation gaps rather than hidden.
13. A fictional multilingual turn naming two nonparticipating children stores both people and both direct parent-child relationships.
14. A later sibling question uses the shared-parent facts conversationally without persisting a sibling edge.
15. A name-only relative is linked to a participant only from attributed, uniquely resolving conversational evidence, never a join event or greeting.

### 14.4 End-to-end synthetic tests

- Signed fictional group webhook -> persisted message -> family-map tool -> updated map -> acknowledgment reply.
- A later fictional message uses the updated relationship context.
- Two groups with similar fictional names never share maps.
- A DM follows the same family-map path as a group.
- Concurrent group updates do not silently overwrite one another.
- Webhook replay creates no additional update, model request, message, or reply.
- Model, tool, Firestore, and LINE reply failures follow the table in section 11.
- Captured logs contain metadata only.

## 15. Acceptance criteria

1. A fictional participant can explicitly state a direct relationship involving a named nonparticipant in a LINE group; exactly one family-map update succeeds and the reply acknowledges it.
2. A later turn from another observed participant receives the correct map and can interpret “Mom” relative to the speaker.
3. The persisted map contains only the direct relationship, not a derived grandparent relationship.
4. Any observed group member can correct the map; the correction takes effect without an additional confirmation.
5. Inspection and forgetting work through ordinary conversation with no UI or command syntax.
6. A DM and a group use identical map contracts and behavior while remaining isolated.
7. The model cannot select a workspace, actor, or source message for the tool call.
8. A complete replacement over 4,000 characters is rejected without changing storage.
9. Concurrent writes use revision checking and cannot silently lose an unrelated successful update.
10. Only the current map exists; clearing it leaves no old map text in family-map storage.
11. Deterministic diagnosis, prescribing, and medication-decision refusal remains unchanged and runs before the agent loop.
12. No real identifiers, family relationships, chat content, prompts, tool arguments, credentials, or health information enter repository artifacts or operational logs.
13. `npm run check`, `npm test`, and `npm run build --workspace @medbuddy/web` pass after implementation.
14. The stored raw text is readable in Firestore and consistently separates participants, named relatives, and direct relationships.
15. Two explicitly named sons of the same parent can be described as siblings in a later response without persisting that derived relationship.

## 16. Rollout and fictional smoke

1. Run contract, package, and synthetic LINE tests with fictional fixtures.
2. Run configuration-gated Vertex evaluation cases for tool selection, correction, preservation, and acknowledgment.
3. Deploy to the existing prototype Cloud Run service only after automated checks pass and the implementation change is separately approved.
4. In a disposable LINE group, use fictional names and relationships to verify create, inspect, correct, derived-reference use, forget, and clear.
5. Repeat the basic create/use/clear flow in a fictional DM.
6. Inspect Firestore to confirm group/DM separation and confirm only the current family-map document exists.
7. Review logs to confirm they contain tool-loop metadata but no map, message, prompt, output, identifier, or credential content.

This smoke validates the feature mechanics only. It does not merge PR #78, authorize production rollout, or broaden the medical-safety contract.

## 17. Commands and expected project locations

The baseline remains the existing Node.js 22+, TypeScript 6, npm 11 modular monolith with Zod contracts, Vitest tests, Firestore persistence, Cloud Run hosting, the direct Vertex REST adapter, and the direct LINE HTTPS adapter. Effort 1 adds no dependency or infrastructure product.

Canonical verification commands:

```bash
npm run check
npm test
npm run build --workspace @medbuddy/web
```

Expected ownership, not an implementation task list:

```text
packages/contracts/       family-map schemas and public interfaces
packages/chat/            family-map module, context assembly, bound update capability
packages/intelligence/    tool declaration, prompt rendering, bounded agent loop, Vertex transport
packages/platform/        Firestore and in-memory adapters
apps/web/                 composition only; existing LINE adapter remains transport-local
```

## 18. Boundaries for implementation planning

### Always

- Preserve strict workspace scoping at every read, write, context, and tool seam.
- Validate tool calls and provider responses before executing or persisting them.
- Keep deterministic medical refusal ahead of model discretion.
- Keep raw LINE identifiers, credentials, and content out of logs and repository artifacts.
- Test through public module interfaces and shared adapter contracts.

### Ask first

- Add another tool, another successful update per turn, or multiple outbound messages.
- Add a relationship schema or semantic content validator.
- Add LINE roster/profile calls, cross-workspace identity, unnamed people, or private memory.
- Change retention, rollout, or medical-safety behavior.
- Add a dependency, database, queue, worker, or agent framework.

### Never

- Let the model provide workspace scope, use a repository directly, or edit files.
- Treat the family map as reviewed medical information.
- Diagnose, prescribe, or recommend medication changes.
- Copy family-map or conversation content into telemetry, fixtures, issues, pull requests, or commits.

## 19. Implementation decisions

The implementation resolved the plan-level questions without changing the approved product scope:

1. The responder uses one 25-second turn deadline and gives each model or tool step only the remaining time.
2. Tool transport remains in the existing direct Vertex REST adapter; Effort 1 adds no dependency.
3. Contracts, orchestration, model transport, persistence, and composition remain in their existing package boundaries.
4. The deployed fictional smoke continues to use the verified `gemini-2.5-flash` model. Its retirement remains tracked in `docs/LINE_SETUP.md` and requires a separately tested successor.

## 20. Explicit deferrals

### Effort 2: long-running conversation continuity

- Preserve the most recent messages verbatim.
- Add progressively compressed, recency-weighted historical context.
- Keep derived summaries untrusted and distinct from the family map and reviewed care facts.

### Effort 3: queryable memory and retrieval tools

- Deterministic filters over promoted workspace memory, reviewed care facts, and attributed source evidence.
- Keyword/text, tags, member/subject, time, trust class, reverse chronology, and bounded limits.
- Vector retrieval only after a measured deterministic-retrieval gap.

### Later agent runtime

- Multiple tools and tool calls.
- Parallel or sequential gathering loops.
- Multiple outbound messages.
- Model-selected completion after no more tools or messages are needed.
- Stronger prompt-injection controls driven by demonstrated evaluation failures.

The family-map module and provider-facing model-step seam should make these additions possible without exposing repositories or changing the workspace isolation model, but Effort 1 must not implement them speculatively.

## 21. References

- [PR #78: LINE-first conversational prototype](https://github.com/olala7846/medbuddy/pull/78)
- `PRODUCT_DIRECTION.md` and `docs/LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md` on PR #78
- [`AGENT_MEMORY_ARCHITECTURE.md`](./AGENT_MEMORY_ARCHITECTURE.md)
- [Vertex AI function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling)
- [Firestore transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [LINE Messaging API webhook reception and redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [LINE Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/)
