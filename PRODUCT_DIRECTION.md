# MedBuddy Product Direction

**Status:** Accepted

**Effective date:** 2026-08-03

**Current priority:** Prove a usable LINE conversational agent in a group or DM.

## North Star

MedBuddy should participate in an existing family conversation and reduce the work of coordinating care. The first proof is intentionally narrower: people in one LINE conversation can exchange useful model-backed text with MedBuddy without data crossing into another conversation.

## First Milestone

The LINE conversation path is implemented. The current increment adds one
workspace-local family map so the agent can understand direct relationships
without becoming a general memory or medical-record system:

```text
verified LINE text event
  -> isolated group or DM workspace
  -> bounded real conversational model
  -> reply to the same LINE conversation
```

- One LINE group, legacy multi-person room, or DM is one workspace.
- A workspace may later contain multiple caregivers and multiple people of interest.
- DMs receive replies to eligible text messages. Groups and rooms receive replies only when the bot is explicitly mentioned.
- Webhook retries must not create another model turn, persisted message, or reply.
- Operational telemetry contains metadata only, never message bodies, prompts, outputs, credentials, or LINE identifiers.

## Priority Order

1. Signature verification, thread isolation, retry deduplication, privacy, and deterministic medical-safety boundaries.
2. A working LINE text -> real model -> LINE reply loop using synthetic fixtures first.
3. Fictional deployed smoke testing and operational visibility.
4. A bounded workspace family map and its single update tool (implemented in Effort 1).
5. Rolling conversation continuity, broader retrieval, medical specialization, attachments, and structured care workflows.

The Telegram-first family-alpha sequence is superseded. Its consent, provenance, retention, and caregiver-workflow ideas remain useful future input, but they do not block this conversational proof.

## Locked Decisions

- LINE Messaging API is the first live channel.
- The existing TypeScript modular monolith, Firestore, Cloud Run, and Vertex foundations remain the target platform.
- LINE types remain in the HTTP adapter; Chat and Intelligence receive channel-neutral contracts.
- Raw LINE identifiers are transformed into stable opaque internal IDs and are never logged.
- Conversation context is bounded to recent messages from exactly one workspace.
- The model receives no repositories. Its only mutation capability is the server-bound `update_workspace_family_map` tool; it cannot write canonical medical facts.
- Deterministic code refuses diagnosis, prescribing, and medication-change decisions before model discretion.
- Rolling summaries, retrieval, cross-thread identity, private participant memory, additional tools, and specialized medical prompts are deferred.

## Public Repository Boundary

Credentials, real LINE identifiers, real messages, health facts, prompts, outputs, screenshots, and raw interview material must never enter repository artifacts or operational logs. Tests and smoke instructions use fictional identifiers and content.

Real family data may be introduced only after a fictional deployed smoke, accurate privacy disclosure, adequate retention/deletion behavior, and a log review.

## Canonical Documents

- Product direction: this file
- Current specification: [`docs/LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md`](./docs/LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md)
- Workspace family-map design: [`docs/proposals/WORKSPACE_FAMILY_MAP_DESIGN.md`](./docs/proposals/WORKSPACE_FAMILY_MAP_DESIGN.md)
- Implementation plan: [`tasks/plan.md`](./tasks/plan.md)
- Executable checklist: [`tasks/todo.md`](./tasks/todo.md)
- Decision record: [`docs/decisions/0002-line-first-conversational-prototype.md`](./docs/decisions/0002-line-first-conversational-prototype.md)
- Family-map decision: [`docs/decisions/0003-add-workspace-family-map.md`](./docs/decisions/0003-add-workspace-family-map.md)
