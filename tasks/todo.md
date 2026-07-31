# Telegram Family Alpha Checklist

**Status:** Ready to execute

**Plan:** [`plan.md`](./plan.md)

**Product source:** [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md)

## Rules

- Use fictional data until Checkpoint B is explicitly approved.
- Complete tasks in dependency order.
- Split any task before it grows beyond approximately five files.
- Run the listed focused verification plus affected repository gates.
- Do not polish the fake-backed web demo unless it directly supports this roadmap.
- Check every staged change for real health data, family identifiers, Telegram identifiers, credentials, and content-bearing logs.

## Phase A — Contract and Channel Proof

### A1 — Telegram boundary contracts

- [ ] Define strict incoming update and outbound action schemas.
- [ ] Normalize Telegram chat, user, message, reply, edit, and media identifiers.
- [ ] Define idempotency semantics for `update_id` and message retries.
- [ ] Add synthetic valid, malformed, duplicate, and unsupported fixtures.
- [ ] Verify: `npm test --workspace @medbuddy/contracts -- --run telegram`.

### A2 — Care subject and steward

- [ ] Separate dependent care subject from Telegram participant identity.
- [ ] Define one technical steward and multiple consenting adults.
- [ ] Reference the subject from facts and the contributor from provenance.
- [ ] Migrate or explicitly preserve existing adult-owner fixtures.
- [ ] Verify: `npm test --workspace @medbuddy/contracts -- --run care-subject consent`.
- [ ] Verify: `npm test --workspace @medbuddy/care-record -- --run authorization`.

### A3 — Telegram Bot API adapter

- [ ] Add minimal Bot API client without an unnecessary framework dependency.
- [ ] Support identity, messages, reactions, files, callback answers, and webhook setup.
- [ ] Add bounded timeout, retry, rate-limit, and safe-error behavior.
- [ ] Enforce the 20 MB hosted Bot API download boundary.
- [ ] Verify: `npm test --workspace @medbuddy/platform -- --run telegram`.

### Checkpoint A — Fictional boundary proof

- [ ] `npm ci --ignore-scripts` passes.
- [ ] `npm run check` passes.
- [ ] `npm test` passes except explicitly configured external smoke suites.
- [ ] A local synthetic webhook harness accepts `/status` for the allowlisted fictional test group.
- [ ] Invalid secrets, chats, and duplicate updates create no state.
- [ ] No real family health information has been introduced.

## Phase B — Live-data Safety Gate

### B1 — Verified idempotent webhook

- [ ] Add the Cloud Run Telegram webhook route.
- [ ] Verify Telegram's secret-token header before parsing content.
- [ ] Enforce the single allowlisted chat.
- [ ] Deduplicate updates before side effects.
- [ ] Return quickly and dispatch bounded background work.
- [ ] Verify: `npm test --workspace @medbuddy/web -- --run telegram-webhook`.
- [ ] Verify: `npm run build --workspace @medbuddy/web`.

### B2 — Activation, consent, and membership

- [ ] Implement `/enable`, `/consent`, `/status`, `/privacy`, and `/pause`.
- [ ] Require each adult's active consent.
- [ ] Require steward approval of the current membership snapshot.
- [ ] Pause on joins, leaves, or uncertain membership.
- [ ] Never process pre-consent or blocked history retrospectively.
- [ ] Verify domain and route tests for every blocked state.

### B3 — Retention and deletion

- [ ] Expire raw media and unreviewed candidates after 30 days.
- [ ] Expire reviewed facts and handoffs after 180 days.
- [ ] Implement `/delete_my_data` with shared-provenance handling.
- [ ] Implement steward-only `/delete_workspace`.
- [ ] Ensure deletion logs metadata only.
- [ ] Verify idempotent retention and deletion tests.

### B4 — Deployment privacy and security

- [ ] Store bot and provider credentials in Secret Manager.
- [ ] Configure private Storage and lifecycle rules.
- [ ] Apply least-privilege runtime, task, storage, and deployer IAM.
- [ ] Remove health content and Telegram identity from logs, traces, and errors.
- [ ] Publish an accurate `/privacy` policy link through BotFather.
- [ ] Install or provide Java 21+ and execute Firestore emulator tests.
- [ ] Triage all reachable high dependency advisories.
- [ ] Add cost, task-failure, and webhook-health alerts without content.

### Checkpoint B — Approve live family data

- [ ] Fictional activation and consent succeed without developer intervention.
- [ ] Membership changes pause processing visibly.
- [ ] Retention and deletion have automated and manual proof.
- [ ] Logs and test artifacts contain no message, media, prompt, or model content.
- [ ] Firestore emulator parity executes rather than skips.
- [ ] Dependency exceptions, if any, have explicit owner acceptance and review dates.
- [ ] The workspace steward explicitly approves introducing real data.

## Phase C — First Product Value

### C1 — Text capture vertical slice

- [ ] Persist an eligible Telegram source message with provenance.
- [ ] Dispatch capture through Cloud Tasks.
- [ ] Run the real constrained extraction path.
- [ ] Validate proposals before candidate persistence.
- [ ] Preserve visible retry/manual-review states.
- [ ] React with exactly one `👀` after successful candidate persistence.
- [ ] Verify the synthetic Telegram text-capture integration suite.

### C2 — Telegram review

- [ ] Implement `/review` pending batches.
- [ ] Implement confirm, correct, reject, and uncertain inline actions.
- [ ] Restrict actions to the attributed contributor.
- [ ] Preserve originals and append review/correction history.
- [ ] Make callback retries idempotent.
- [ ] Verify review, correction, authorization, and replay tests.

### C3 — Timeline and pre-visit brief

- [ ] Implement `/timeline [window]`.
- [ ] Implement `/prepare_visit [window]` with a 14-day default.
- [ ] Include reviewed observations, reported treatments, changes, uncertainty, conflicts, questions, sources, and covered range.
- [ ] Exclude rejected facts and visibly label incompleteness.
- [ ] Verify the synthetic message-to-fact-to-review-to-brief golden path.

### Checkpoint C — Demonstrate actual value

- [ ] A natural fictional observation becomes a reviewed fact in Telegram.
- [ ] `/prepare_visit 14d` produces a useful source-linked brief.
- [ ] Human feedback covers usefulness, interruption, attribution, and missing context.
- [ ] Approved feedback is reflected before media work starts.

## Phase D — Media and After-visit Value

### D1 — Telegram media ingestion

- [ ] Download only supported images/documents within configured limits.
- [ ] Validate magic bytes, declared type, size, checksum, ownership, and path.
- [ ] Store private bytes with 30-day deletion.
- [ ] Submit bounded media to the multimodal model.
- [ ] Preserve reporter description and prohibit diagnosis from skin images.
- [ ] Verify malformed, oversized, failed, duplicate, and injection media fixtures.

### D2 — After-visit communication

- [ ] Implement `/after_visit` over recent supplied evidence.
- [ ] Distinguish document text, caregiver report, AI organization, and unknowns.
- [ ] Treat medication/treatment changes as reported facts, not recommendations.
- [ ] Require participant confirmation before handoff creation.
- [ ] Preserve immutable prior handoff versions.
- [ ] Verify the synthetic after-visit golden path.

## Phase E — Conversation and Live Rollout

### E1 — Source-grounded conversational agent

- [ ] Respond naturally to mentions and direct replies.
- [ ] Give the agent read-only access to approved timeline, facts, and documents.
- [ ] Cite sources or state that the record is insufficient.
- [ ] Route medical decisions and narrow urgent language deterministically before model discretion.
- [ ] Prevent prompt injection from changing access, facts, safety, or secrets.
- [ ] Verify conversation, refusal, injection, malformed-output, and provider-failure tests.

### E2 — One-family alpha

- [ ] Deploy the approved build.
- [ ] Verify pause and deletion with non-sensitive messages.
- [ ] Activate the private family group through the user-facing consent flow.
- [ ] Monitor metadata-only operational health.
- [ ] Record only anonymized workflow findings and product decisions.
- [ ] After one week, explicitly decide whether the family wants to keep using the bot.

## Final Success

- [ ] The live private group safely completes message -> fact -> review -> pre-visit brief.
- [ ] Images and after-visit documents preserve provenance and require review.
- [ ] Mentioned conversation is helpful without becoming noisy or medically authoritative.
- [ ] Retention, deletion, consent, and membership controls work in deployment.
- [ ] The family chooses continued use based on experienced value, not demo appearance.
