# Implementation Plan: First LINE Conversational Prototype

**Status:** Approved for execution

**Requirements:** [`../docs/LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md`](../docs/LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md)

## Outcome

```text
signed LINE text -> isolated workspace -> real model boundary -> same-event LINE reply
```

Use synthetic fixtures until the local path is complete. Keep the model tool-free and preserve deterministic medical refusal.

## Dependency Order

1. **Canonical direction and contract** — replace the Telegram-first execution sequence and define channel-neutral external identity.
2. **Thread conversation** — persist one external turn, load only that workspace's bounded context, invoke the responder, and persist one MedBuddy turn.
3. **Conversational provider** — allow validated bounded text through the existing Vertex adapter after deterministic safety routing.
4. **LINE boundary** — raw-body signature verification, strict event parsing, opaque ID mapping, durable event claim, mention policy, and reply client.
5. **Composition and operations** — environment/secret configuration, metadata-only diagnostics, synthetic smoke command, and live setup guide.
6. **Review and handoff** — focused/full tests, build, audit, staged privacy review, commits, push, and PR. Merge only with explicit authorization.

## Risk Decisions

| Risk | Decision |
| --- | --- |
| Duplicate webhook delivery | Atomically claim `webhookEventId` before model/reply side effects. |
| Crash after event claim | Accept a possibly lost reply in this prototype; do not risk duplicate replies. |
| Cross-thread context | Derive opaque workspace IDs from channel + conversation type + conversation ID; every query stays workspace-scoped. |
| Group noise | Require LINE's `isSelf` mention marker for group/room events. |
| Medical overreach | Route deterministic diagnosis/prescribing/medication decisions before model invocation. |
| Sensitive telemetry | Emit only allowlisted metadata and safe codes; never body/prompt/output/token/provider ID. |
| Reply-token expiry | Process synchronously with bounded provider/LINE timeouts and use the token immediately. |

## Verification Checkpoints

### Contract and model

```bash
npm test --workspace @medbuddy/contracts -- --run external-conversation
npm test --workspace @medbuddy/intelligence -- --run conversation vertex
```

### Thread and LINE integration

```bash
npm test --workspace @medbuddy/chat -- --run external-conversation
npm test --workspace @medbuddy/web -- --run line
```

### Final gate

```bash
npm run check
npm test
npm run build --workspace @medbuddy/web
npm audit --omit=dev
```

## Explicitly Deferred

Rolling memory, long-term memory, embeddings, retrieval, tools, specialized medical prompts, care-fact capture/review, visit briefs, attachments, cross-thread identity, participant-private memory, multiple live providers, and a new UI.
