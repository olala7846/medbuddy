# Spec: First LINE Conversational Prototype

**Status:** Approved for implementation

**Date:** 2026-08-03
**Source of priority:** [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md)

> **Effort 1 follow-up:** This base loop now includes one workspace family map
> and its server-bound replacement tool. See
> [`proposals/WORKSPACE_FAMILY_MAP_DESIGN.md`](./proposals/WORKSPACE_FAMILY_MAP_DESIGN.md).
> This narrow change supersedes the original one-call/no-tool baseline only.
> Repository access, medical writes, extra tools, and broader memory remain
> prohibited or deferred.

## Objective

Prove that a signed synthetic LINE text event can safely map to one isolated
workspace, cross a real model boundary, and produce one LINE reply. Live
credentials are not required for development or automated verification.

Test whether a small channel-neutral thread model can support this loop without
premature memory, tools, or medical workflows.

## Stack and commands

- Node.js 22+, TypeScript 6, npm 11 workspaces, Zod, Vitest, Next.js 16.
- Vertex AI: existing direct REST adapter and Application Default Credentials.
- LINE Messaging API: direct HTTPS calls; no bot framework.

```bash
npm run check
npm test
npm run build --workspace @medbuddy/web
```

## Identity and event eligibility

The channel-neutral external identity contains channel (`LINE`), conversation
type (`DM` or `GROUP`), opaque conversation/thread and sender identifiers, and
provider message and event identifiers.

The LINE adapter validates provider shapes and hashes provider identifiers into
branded workspace, member, and message IDs. Raw identifiers and reply tokens
stay in the adapter. Do not persist or log them.

- Respond to DM text messages.
- Respond to group or legacy-room text only when
  `mention.mentionees[].isSelf` is `true`.
- Do not persist or reply to standby, missing-sender, non-text, malformed, or
  unsupported events.
- Return success for an empty signed event list. LINE uses it to verify the
  webhook in the console.

## Processing contract

1. Read the untouched UTF-8 request body.
2. Verify `x-line-signature` with HMAC-SHA256, the channel secret, and a
   constant-time comparison.
3. Parse the signed body with strict boundary schemas and a size limit.
4. Claim each `webhookEventId` in a durable receipt store before any external
   side effect.
5. Derive opaque internal IDs from the LINE conversation and sender.
6. Persist the human text turn in that workspace.
7. Load no more than 20 messages from that workspace.
8. Apply deterministic medical-decision refusal before calling the model.
9. Otherwise, call the configured real conversational provider.
10. Persist the MedBuddy turn and immediately use the event's one-time reply
    token.
11. Mark the receipt complete with metadata only.

Claim before side effects provides retry deduplication and at-most-once
processing. A failure after a claim can lose a reply. Recovery and push-message
fallback are deferred to avoid duplicate replies.

## Model and medical safety

- Give the model bounded text context from one workspace only.
- Give it one server-bound family-map replacement tool. Do not give it a
  repository, storage handle, credentials, or canonical medical-write
  authority.
- Validate output as bounded text before persistence or reply.
- Existing deterministic routes refuse diagnosis, prescribing, and medication
  start, stop, or change decisions before provider invocation.
- The system instruction states general limits. It is not a security boundary.
- On provider failure or malformed output, do not invent a fallback medical
  answer.

## Observability

Metadata-only events must show rejection reason; receipt status (claimed,
deduplicated, completed, or failed); retryable model or LINE failure; and
affected conversation type without its identifier or content.

Allowed fields: stable event name, correlation ID, conversation type, outcome,
duration class, and safe error code. Do not log request bodies, messages,
prompts, outputs, reply tokens, access tokens, or provider identifiers.

## Testing and acceptance

- Unit tests cover identity derivation, strict parsing, signature verification,
  mention policy, context isolation, medical refusal, and output validation.
- Synthetic integration: signed LINE webhook -> in-memory receipt/message
  stores -> fixed model -> fixed reply client.
- Required cases: invalid signature; empty event list; malformed or unsupported
  event; duplicate or concurrent delivery; separate group/DM workspaces;
  missing sender; provider or reply failure; and content-free logs.
- Real Vertex and LINE calls are configuration-gated smoke tests only.

The prototype passes when all of these are true:

1. A valid signed synthetic DM event produces one persisted human turn, one
   model-backed MedBuddy turn, and one reply.
2. A valid mentioned group event does the same. An unmentioned group event is
   ignored.
3. Replaying an event creates no additional state, model request, or reply.
4. Two LINE conversations map to different workspaces and cannot read each
   other's messages.
5. Invalid signatures and unsupported events create no state or reply.
6. A deterministic medication-decision request bypasses the model and returns
   the existing safe refusal.
7. Deployment configuration can select real Vertex while tests use a
   deterministic fake.
8. `npm run check`, `npm test`, and the web build pass.

## Boundaries

### Always

- Verify the exact raw body before JSON parsing.
- Key thread-scoped reads and writes by derived workspace ID.
- Bound body size, text length, context length, provider timeout, and LINE
  reply timeout.
- Use synthetic content and identifiers in repository artifacts.

### Ask first

- Add real family data or identifiers.
- Add a dependency, database, background worker, tool, memory layer, or
  medical prompt.
- Change retention, deletion, consent, or live-rollout policy.

### Never

- Commit or log credentials, LINE identifiers, chat content, prompts, outputs,
  or health information.
- Trust unsigned input, model output, or LINE API responses without validation.
- Diagnose, prescribe, or recommend medication changes.
- Read messages from another workspace or infer identity across conversations.

## Deferred

Defer rolling summaries, embeddings, retrieval, extra tools, specialized
medical prompts, care-fact extraction, review, visit briefs, attachments,
cross-thread identity, participant-private memory, other channels, and a UI.

## Official LINE sources

- [Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [Receive messages and redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [Messaging API webhook and reply reference](https://developers.line.biz/en/reference/messaging-api/nojs/)
- [Group chats and multi-person chats](https://developers.line.biz/en/docs/messaging-api/group-chats/)
- [Send messages](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
