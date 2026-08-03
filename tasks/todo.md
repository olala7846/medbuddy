# First LINE Conversational Prototype Checklist

## Documentation

- [x] Make LINE conversation the canonical first milestone.
- [x] Preserve Telegram documents as explicitly superseded history.
- [x] Record current official LINE webhook, mention, redelivery, and reply constraints.

## Contract and Conversation

- [ ] Define strict channel-neutral external conversation identity.
- [ ] Derive opaque workspace/member/message IDs without retaining raw LINE identifiers.
- [ ] Persist and retrieve at most 20 messages within one workspace.
- [ ] Exercise the real model seam with deterministic fakes in tests.
- [ ] Preserve deterministic diagnosis, prescribing, and medication-decision refusal.

## LINE Boundary

- [ ] Verify HMAC-SHA256 over the untouched raw request body before parsing.
- [ ] Bound request size and strictly validate eligible active text events.
- [ ] Reply to DMs and explicit self-mentions in groups/rooms.
- [ ] Claim `webhookEventId` before model or reply side effects.
- [ ] Prove replay, concurrent duplicate, invalid signature, unsupported event, and empty-event behavior.
- [ ] Prove separate group/DM workspaces cannot see each other's messages.
- [ ] Keep logs metadata-only and content-free.

## Configuration and Smoke

- [ ] Wire LINE channel secret and access token from environment/Secret Manager only.
- [ ] Wire Vertex through Application Default Credentials and existing environment configuration.
- [ ] Document the LINE Developers Console steps and public HTTPS webhook requirement.
- [ ] Provide one synthetic local smoke command requiring no live credentials.

## Final Gate

- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run build --workspace @medbuddy/web`
- [ ] `npm audit --omit=dev` with reachable findings triaged.
- [ ] Review correctness, simplicity, architecture, security, performance, secrets, PII, health information, and logs.
- [ ] Commit in small logical increments and push `codex/line-conversation-prototype`.
- [ ] Open a PR; do not merge without user authorization.
