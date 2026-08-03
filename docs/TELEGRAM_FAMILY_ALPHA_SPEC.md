# Spec: Telegram Family Alpha

**Status:** Superseded by [`LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md`](./LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md) on 2026-08-03; retained as historical design input

**Date:** 2026-07-31

**Source of priority:** [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md)

## 1. Objective

Build a live MedBuddy bot that participates in one private Telegram family group and helps two adult caregivers coordinate care for one dependent child.

The bot must passively capture attributed observations and reported instructions, maintain a reviewable timeline, prepare a factual pre-visit brief, and draft an after-visit family communication when requested. It should feel like a useful participant in the existing conversation rather than a separate application the family must maintain.

The first product-value milestone is complete when a natural Telegram message becomes a reviewed fact and appears with source attribution in a useful 14-day pre-visit brief.

### Primary jobs

- Capture an observation without making the family fill out a form.
- Reconstruct what changed and when before an appointment.
- Preserve what a caregiver reports versus what a document states.
- Turn recent evidence into a concise list of observations and unresolved questions.
- Draft an after-visit update without converting an AI interpretation into clinical fact.

### Participants and authority

| Concept | Alpha meaning |
| --- | --- |
| Care subject | The dependent child whose care is being coordinated; represented by an alias and not required to be a Telegram participant. |
| Workspace steward | One self-attested adult guardian who activates the workspace, approves membership, controls retention, and may delete the workspace. |
| Adult participant | A parent or caregiver who independently consents, contributes messages, and reviews their own extracted claims. |
| MedBuddy | A conservative organizer with no authority to diagnose, prescribe, or make treatment decisions. |

MedBuddy does not verify guardianship or adjudicate disagreements between adults.

## 2. User Experience

### 2.1 Activation and consent

1. The bot is added to a new private Telegram group with Group Privacy Mode disabled.
2. The steward invokes `/enable` and receives a plain-language disclosure covering passive access, model processing, Telegram cloud storage, retention, deletion, and limitations.
3. Every adult participant invokes `/consent` after reading the disclosure.
4. The steward approves the displayed Telegram membership snapshot.
5. Capture begins only when the workspace and every current adult participant are approved.
6. A join, leave, or other detected membership change immediately pauses capture and health-related output.

Messages posted before activation or while blocked are not processed retrospectively.

### 2.2 Passive capture

For an eligible human message, MedBuddy:

1. records the Telegram source identifiers and contributor;
2. stores only the data required by the retention policy;
3. proposes atomic facts with event-time uncertainty and provenance;
4. validates model output before canonical persistence;
5. reacts with `👀` only when at least one candidate is retained for review; and
6. otherwise remains silent.

`👀` means “captured for review,” never “verified,” “safe,” or “clinically important.”

### 2.3 Review

`/review` returns a compact batch of pending candidate facts. A participant may confirm, correct, reject, or mark uncertain only the claims attributed to them. Conflicts remain separately attributed. Review actions append history rather than overwriting the original source.

### 2.4 Pre-visit brief

`/prepare_visit 14d` produces a draft organized into:

- confirmed recent observations;
- treatments or medications reported by participants;
- changes over time;
- relevant documents or photos;
- conflicts and uncertainty;
- unresolved questions for a professional; and
- limitations and the covered date range.

Every material statement must trace to source messages, reviewed facts, or documents. Unreviewed material is either excluded or visibly labeled.

### 2.5 After-visit communication

After a participant posts a visit document, photo, or reported instruction, `/after_visit` drafts:

- what the clinician or document reportedly communicated;
- reported treatment or medication changes;
- follow-up actions and dates;
- remaining questions; and
- a concise family update.

The draft requires participant confirmation before it is treated as a reviewed handoff. OCR or model extraction from a document is not professional verification.

### 2.6 Conversational participation

MedBuddy responds when mentioned, directly replied to, or invoked with a supported command. It may answer factual questions using the approved workspace record and must expose source and uncertainty. It must not continuously chatter, introduce unsourced medical knowledge, or turn a skin photo into a diagnosis.

### 2.7 Control commands

The alpha supports:

- `/status` — activation, consent, membership, and retention state;
- `/privacy` — what the bot receives, stores, sends to providers, and cannot delete from Telegram;
- `/enable` and `/consent` — deterministic activation flow;
- `/pause` — stop future processing and health-related output;
- `/review` — review pending facts;
- `/timeline [window]` — show attributed history;
- `/prepare_visit [window]` — create a factual visit brief;
- `/after_visit` — draft an after-visit summary from recent supplied evidence;
- `/delete_my_data` — delete the requesting participant's retained data where compatible with shared provenance; and
- `/delete_workspace` — steward-controlled deletion of the MedBuddy workspace.

## 3. Functional Requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| TG-001 | Accept only authenticated Telegram updates for the allowlisted group. | Invalid webhook secrets and non-allowlisted chat IDs create no persistent state or response. |
| TG-002 | Deduplicate retries by Telegram `update_id` and message identity. | Replaying an update produces no duplicate message, fact, reaction, or response. |
| CONS-101 | Require active consent from every adult and steward approval of current membership. | Pre-consent and post-membership-change messages are not processed. |
| SUBJ-101 | Separate the dependent care subject from adult participants. | Facts reference the care subject while provenance references the contributing adult. |
| CAP-101 | Convert eligible text into validated atomic candidate facts. | A synthetic observation creates attributed, reviewable candidates with event-time uncertainty. |
| CAP-102 | Acknowledge retained candidates without interrupting the group. | The source receives one `👀` reaction only after candidate persistence. |
| REV-101 | Let contributors review their own extracted claims. | Confirm, correct, reject, and uncertain actions preserve source history and authorization. |
| VISIT-101 | Produce a source-linked pre-visit brief. | A 14-day synthetic scenario produces the expected timeline, uncertainty, and unresolved questions. |
| MEDIA-101 | Admit Telegram images and documents safely. | Size, type, checksum, private path, retention, and model-boundary tests pass. |
| AVS-101 | Draft an after-visit communication from supplied evidence. | The draft distinguishes document text, reported instruction, AI organization, and unknowns. |
| CHAT-101 | Answer mentioned factual questions from approved workspace context. | Responses cite internal sources and never mutate canonical facts directly. |
| SAFE-101 | Refuse diagnosis, prescribing, and medication decisions before model discretion. | Deterministic bilingual fixtures route to refusal and professional follow-up. |
| SAFE-102 | Avoid a continuous safety-monitoring claim. | `/privacy`, activation, and summaries state the limitation clearly. |
| DATA-101 | Enforce default retention and deletion. | Raw media expires after 30 days; reviewed facts after 180 days; deletion is auditable without logging content. |
| OPS-101 | Keep sensitive content out of operational telemetry. | Log tests and manual review show identifiers and status only, not messages, images, prompts, or outputs. |

## 4. Technical Stack

- TypeScript modular monolith in the existing npm workspace.
- Telegram Bot API webhook served by the existing web/Cloud Run application.
- Firestore for workspaces, participants, normalized messages, facts, reviews, and handoff versions.
- Private Cloud Storage for retained media with a 30-day lifecycle.
- Cloud Tasks for bounded asynchronous capture and media processing.
- Vertex AI through the existing intelligence adapter for constrained extraction and conversation.
- Zod validation at Telegram, model-output, persistence, and command boundaries.

No microservices, vector database, dedicated mobile app, or new web UI is required for the alpha.

## 5. Architecture and Project Structure

Target additions follow existing package boundaries:

```text
apps/web/app/api/telegram/       Webhook HTTP adapter only
apps/web/src/telegram/           Telegram composition and command routing
packages/contracts/src/          Channel, care-subject, consent, retention contracts
packages/chat/src/               Channel-neutral message orchestration
packages/care-record/src/        Steward, subject, review, timeline, handoff policy
packages/intelligence/src/       Extraction, summarization, safety, conversation
packages/platform/src/telegram/  Telegram Bot API adapter
packages/platform/src/           Firestore, Tasks, Storage, retention adapters
tests/                            Cross-module synthetic Telegram golden path when introduced
```

Dependency policy remains inward-facing: Telegram types are translated at the adapter boundary and must not leak into canonical care-record facts.

### Runtime flow

```text
Telegram update
  -> verify webhook + allowlisted chat
  -> deduplicate and normalize actor/message/media
  -> enforce consent + membership snapshot
  -> persist source message
  -> deterministic safety route
  -> dispatch bounded capture task
  -> validate model proposals
  -> persist candidate facts
  -> react or answer in Telegram
  -> review -> timeline -> visit brief / after-visit handoff
```

## 6. Commands

Existing repository commands remain release gates:

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run build --workspace @medbuddy/web
npm run test:e2e
```

The Telegram implementation must add and document focused commands with these stable forms:

```bash
npm test --workspace @medbuddy/contracts -- --run telegram care-subject consent retention
npm test --workspace @medbuddy/platform -- --run telegram
npm test --workspace @medbuddy/web -- --run telegram
npm test -- --run telegram-golden-path
```

Deployment commands must be added to `infra/README.md` before live activation; no undocumented console-only deployment counts as complete.

## 7. Code Style

Translate external input once, validate it, and pass channel-neutral data inward:

```ts
const update = TelegramUpdateSchema.parse(requestBody);
const source = normalizeTelegramMessage(update, allowlistedChat);
await chatService.appendExternalMessage(actor, source);
```

- External field names stay inside Telegram adapters.
- Model output is an untrusted proposal parsed through strict schemas.
- Policy functions are deterministic and free of network I/O.
- Errors contain stable codes and no health content.
- Tests use synthetic family scenarios and example identifiers only.

## 8. Testing Strategy

1. **Contract tests:** Telegram updates, external identities, care subjects, consent, retention, and model proposals.
2. **Domain tests:** steward authority, participant consent, membership blocking, fact review, timeline windows, and immutable handoffs.
3. **Adapter tests:** webhook verification, retry deduplication, Telegram API failures, media limits, Storage lifecycle, Tasks, and Firestore parity.
4. **Intelligence tests:** extraction, summarization, refusal, urgent-language routing, prompt injection, unsupported images, and malformed model output.
5. **Golden-path integration:** synthetic Telegram updates flow through capture, review, pre-visit brief, later event, and after-visit draft.
6. **Manual fictional smoke:** deployed private test group before live data.
7. **Live family alpha:** only after the privacy/security checkpoint is explicitly approved; no real content enters test artifacts.

## 9. Privacy, Security, and Safety Boundaries

### Always

- Require explicit, active, revocable consent from every adult participant.
- Fail closed on membership change, unknown chat, unknown actor, invalid webhook secret, and provider uncertainty.
- Encrypt retained data at rest and keep credentials in Secret Manager.
- Minimize stored Telegram profile data and health content.
- Preserve source attribution, review status, uncertainty, and edit history.
- Validate Telegram input, file content, model output, and outbound rendering.
- Redact health content, Telegram identifiers, prompts, and model output from logs and errors.
- Keep the repository fictional-data-only.

### Ask first

- Change default retention periods.
- Add a participant, group, care subject, model provider, channel, or externally shared recipient.
- Grant the bot Telegram administrator privileges.
- Add medical reference data or proactive safety behavior.
- Use live family content for debugging, evaluation, screenshots, or support.

### Never

- Commit or log real family health information, identifiers, credentials, or media.
- Diagnose from a photo or infer causality between an observation and treatment.
- Recommend starting, stopping, changing, skipping, or dosing medication.
- Treat an LLM response, OCR result, or caregiver report as verified professional instruction.
- Process pre-consent history retrospectively.
- Claim that Telegram group messages are end-to-end encrypted or that MedBuddy provides continuous safety monitoring.
- Train or fine-tune a model using family data.

## 10. Retention and Deletion

- Raw downloaded media: delete after 30 days unless deleted earlier.
- Reviewed structured facts and handoffs: delete after 180 days unless deleted earlier.
- Unreviewed candidates: delete after 30 days.
- Telegram update deduplication metadata: retain only as long as necessary to prevent replay within the operating window.
- Deletion removes MedBuddy-controlled copies and derived data where provenance permits; it cannot recall Telegram history or copies held by participants.

Retention jobs must be idempotent, observable through metadata-only logs, and covered by tests.

## 11. Success Criteria

The family alpha is ready when:

1. A private Telegram group completes activation and consent without developer intervention.
2. A natural synthetic observation flows from Telegram to a reviewed fact and receives one capture reaction.
3. `/prepare_visit 14d` creates a useful, source-linked brief from reviewed facts.
4. A supplied synthetic after-visit document creates a reviewed draft that preserves provenance and uncertainty.
5. Mentioned factual questions use only approved workspace context and deterministic safety boundaries.
6. Membership changes pause processing.
7. Pause, deletion, and retention behavior are demonstrably effective.
8. The deployed fictional-data smoke passes before real data is introduced.
9. The participating family chooses to keep the bot in the group after a week of ordinary use.

## 12. Explicit Non-goals

- AI Fund presentation polish or a reviewer-specific demo path.
- Rebuilding the web interface.
- Appointment calendar synchronization or reminders.
- Clinician accounts, EHR integration, or verified medical records.
- Diagnosis, triage completeness, treatment planning, or autonomous decisions.
- Multiple groups, multiple care subjects, public onboarding, or generalized guardianship.
- LINE, WhatsApp, voice calls, or audio transcription.
- Analytics, vector search, long-term model memory, or model training on family data.

## 13. External Constraints

- Telegram bots must use polling or webhooks, not both simultaneously.
- Passive group capture requires Group Privacy Mode to be disabled or the bot to be an administrator; the alpha avoids unnecessary administrator rights.
- The hosted Bot API currently limits bot file downloads to 20 MB.
- Telegram group chats are cloud chats, not Secret Chats; activation must disclose this.
- Telegram developer terms require an accessible privacy policy, explicit revocable consent for voluntarily submitted data, minimization, retention controls, deletion, and secure storage.

Authoritative references:

- [Telegram Bots FAQ](https://core.telegram.org/bots/faq)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Bot Platform Developer Terms](https://telegram.org/tos/bot-developers)
- [Telegram security FAQ](https://telegram.org/faq#q-how-secure-is-telegram)
