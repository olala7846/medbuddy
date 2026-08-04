# Spec: First LINE Conversational Prototype

**Status:** Approved for implementation

**Date:** 2026-08-03

**Source of priority:** [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md)

> **Effort 1 follow-up:** The base loop below now includes the approved
> workspace family map and its single server-bound update tool. See
> [`proposals/WORKSPACE_FAMILY_MAP_DESIGN.md`](./proposals/WORKSPACE_FAMILY_MAP_DESIGN.md).

## Objective

Prove that MedBuddy can safely participate in a LINE DM or group conversation. A signed synthetic LINE text event must map to an isolated workspace, use a real model boundary, and produce one reply through the LINE reply API. Live credentials are not required for development or automated verification.

This prototype answers one question: **does a small channel-neutral thread model support a safe, usable LINE conversation loop without prematurely building memory, tools, or medical workflows?**

## Stack and Commands

- Node.js 22+, TypeScript 6, npm 11 workspaces, Zod, Vitest, Next.js 16.
- Vertex AI through the existing direct REST adapter and Application Default Credentials.
- LINE Messaging API through direct HTTPS calls; no new bot framework.

```bash
npm run check
npm test
npm run build --workspace @medbuddy/web
```

## Contract

The channel-neutral external identity contains:

- channel (`LINE` for this slice);
- conversation type (`DM` or `GROUP`);
- opaque conversation/thread identifier;
- opaque sender identifier;
- provider message identifier; and
- provider event identifier.

The LINE adapter validates provider shapes, then hashes provider identifiers into branded internal workspace, member, and message IDs. Raw identifiers and reply tokens remain adapter-local and are never persisted as message content or logged.

## Eligible Events

- DM text message: respond.
- Group or legacy room text message: respond only when `mention.mentionees[].isSelf` is `true`.
- Active-mode events only; standby, missing-sender, non-text, malformed, and unsupported events produce no persistence or reply.
- An empty signed event list returns success for LINE console webhook verification.

## Processing Order

1. Read the untouched UTF-8 request body.
2. Verify `x-line-signature` with HMAC-SHA256 and the channel secret using constant-time comparison.
3. Parse the signed body with strict boundary schemas and a size limit.
4. Claim each `webhookEventId` in a durable receipt store before external side effects.
5. Derive opaque internal IDs from the LINE conversation and sender.
6. Persist the human text turn under that workspace.
7. Load at most 20 messages from the same workspace.
8. Apply deterministic medical-decision refusal before model invocation.
9. Otherwise call the configured real conversational provider.
10. Persist the MedBuddy turn and immediately use the event's one-time reply token.
11. Mark the receipt complete using metadata only.

Claim-before-side-effect gives retry deduplication and at-most-once processing. A process failure after a claim can lose a reply; recovery and push-message fallback are explicitly deferred rather than risking duplicate replies in this prototype.

## Model and Medical Safety

- The model receives bounded text context from one workspace only.
- The model has one server-bound family-map replacement tool, but no repository,
  storage handle, credentials, or canonical medical write authority.
- Output is validated as bounded text before persistence or reply.
- Existing deterministic routes refuse diagnosis, prescribing, and medication-start/stop/change decisions before provider invocation.
- The system instruction states general limitations but is not treated as a security boundary.
- Provider failure or malformed output causes no fabricated fallback medical answer.

## Observability Questions

Metadata-only events must let an operator answer:

1. Was a webhook rejected for signature, shape, or size?
2. Was an eligible event claimed, deduplicated, completed, or failed?
3. Did the model or LINE reply dependency fail, and was it retryable?
4. Which conversation type was affected without revealing its identifier or content?

Allowed fields are stable event name, correlation ID, conversation type, outcome, duration class, and safe error code. Request bodies, messages, prompts, outputs, reply tokens, access tokens, and provider identifiers are prohibited.

## Testing Strategy

- Small tests: identity derivation, strict parsing, signature verification, group mention policy, context isolation, medical refusal, output validation.
- Medium synthetic integration: signed LINE webhook -> in-memory receipt/message stores -> fixed model -> fixed reply client.
- Required cases: invalid signature, empty event list, malformed and unsupported events, duplicate and concurrent delivery, separate group/DM workspaces, missing sender, provider failure, reply failure, and content-free logs.
- Real Vertex and LINE calls are configuration-gated smoke tests only.

## Boundaries

### Always

- Verify the exact raw body before JSON parsing.
- Keep thread-scoped queries and writes keyed by the derived workspace ID.
- Bound body size, text length, context length, provider timeout, and LINE reply timeout.
- Use synthetic content and identifiers in repository artifacts.

### Ask first

- Introduce real family data or identifiers.
- Add a new dependency, database, background worker, tool, memory layer, or medical prompt.
- Change retention, deletion, consent, or live rollout policy.

### Never

- Commit or log credentials, LINE identifiers, chat content, prompts, outputs, or health information.
- Trust unsigned input, model output, or LINE API responses without validation.
- Diagnose, prescribe, or recommend medication changes.
- Retrieve messages from another workspace or infer identity across conversations.

## Success Criteria

1. A valid signed synthetic DM event produces one persisted human turn, one model-backed MedBuddy turn, and one reply.
2. A valid mentioned group event follows the same path; an unmentioned group event is ignored.
3. Replaying an event produces no additional state, model request, or reply.
4. Two LINE conversations map to different workspaces and cannot read one another's messages.
5. Invalid signatures and unsupported events produce no state or reply.
6. Deterministic medication-decision requests bypass the model and return the existing safe refusal.
7. The real Vertex adapter is selectable through deployment configuration while tests use a deterministic fake.
8. `npm run check`, `npm test`, and the web build pass.

## Deferred

Rolling conversation summaries, embeddings, retrieval, additional tools, specialized medical prompts, care-fact extraction, review, visit briefs, attachments, cross-thread identity, participant-private memory, multiple channel implementations, and a new UI.

## Official LINE Sources

- [Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [Receive messages and redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [Messaging API webhook and reply reference](https://developers.line.biz/en/reference/messaging-api/nojs/)
- [Group chats and multi-person chats](https://developers.line.biz/en/docs/messaging-api/group-chats/)
- [Send messages](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
