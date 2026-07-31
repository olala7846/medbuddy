# Implementation Plan: Telegram Family Alpha

**Status:** Approved for execution

**Product source:** [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md)

**Requirements:** [`../docs/TELEGRAM_FAMILY_ALPHA_SPEC.md`](../docs/TELEGRAM_FAMILY_ALPHA_SPEC.md)

## 1. Outcome

Deliver a private Telegram bot that provides repeated value to one family. The first product-value milestone is a complete vertical path:

```text
natural Telegram message
  -> consent and membership gate
  -> attributed candidate facts
  -> contributor review
  -> source-linked 14-day pre-visit brief
```

Images, after-visit documents, and richer conversation follow this path. Web-demo polish, additional channels, and public onboarding do not block it.

## 2. Planning Principles

1. Build vertical slices that can be exercised in Telegram.
2. Use fictional data until the live-data safety checkpoint explicitly passes.
3. Reuse the modular monolith, existing contracts, intelligence, persistence, and Terraform foundations.
4. Keep Telegram details at adapter boundaries.
5. Make deterministic code—not the model—authoritative for consent, membership, provenance, retention, deletion, and medical refusal.
6. Stop and test family value after the pre-visit brief before expanding scope.

## 3. Architecture Decisions

- **Channel:** Telegram Bot API using a Cloud Run HTTPS webhook with secret-token verification.
- **Scope:** Exactly one allowlisted private group, two adult participants, and one dependent care subject in the first deployment.
- **Authority:** One adult technical steward; every adult independently consents; any membership change fails closed.
- **Storage:** Firestore for canonical records and private Cloud Storage for retained media.
- **Work:** Cloud Tasks for bounded asynchronous capture; synchronous deterministic safety routing occurs before model work.
- **Intelligence:** Vertex through the existing adapter; model output remains a validated proposal and cannot write canonical facts directly.
- **Interaction:** Passive `👀` capture acknowledgement, commands for review and summaries, mention/reply for conversation.
- **Retention:** 30 days for raw media and unreviewed candidates; 180 days for reviewed structured facts and handoffs.
- **Presentation:** Telegram is the product surface. The existing web app remains a test and diagnostic surface.

## 4. Dependency Graph

```text
Product direction + approved spec
  -> Telegram and care-subject contracts
     -> Telegram API adapter
     -> steward/consent/membership policy
        -> webhook and normalized message persistence
           -> retention/deletion safety gate
              -> live text capture and review
                 -> timeline and pre-visit brief
                    -> media ingestion
                       -> after-visit draft
                          -> richer conversational agent
                             -> one-family live alpha
```

## 5. Phases and Tasks

### Phase A — Contract and non-sensitive channel proof

#### A1 — Define Telegram boundary contracts

Add strict contracts for incoming updates, external chat/user/message identity, normalized source metadata, webhook deduplication, and outbound actions.

**Acceptance:**

- Synthetic Telegram updates parse into channel-neutral source messages.
- Unknown update shapes fail without partial state.
- External identifiers never become canonical medical facts.

**Verification:**

```bash
npm test --workspace @medbuddy/contracts -- --run telegram
npm run check
```

**Dependencies:** None

**Estimated scope:** Medium, 3–5 files

#### A2 — Define care-subject and steward contracts

Separate the dependent care subject from participant identity and replace the assumption that the health subject must be the sole adult owner.

**Acceptance:**

- One dependent subject can be linked to one steward and multiple adult participants.
- Facts reference a subject while provenance references a contributor.
- Existing adult-owner fixtures either migrate explicitly or remain supported through a clear compatibility path.

**Verification:**

```bash
npm test --workspace @medbuddy/contracts -- --run care-subject consent
npm test --workspace @medbuddy/care-record -- --run authorization
```

**Dependencies:** None

**Estimated scope:** Medium, 3–5 files

#### A3 — Implement the Telegram Bot API adapter

Provide a small outbound client for identity checks, messages, reactions, files, and webhook setup. Do not add a general Telegram framework unless direct HTTP becomes materially harder.

**Acceptance:**

- All outbound methods have bounded timeouts and stable failure codes.
- The bot token is injected and never logged.
- Contract tests cover retries, rate limits, malformed responses, and the 20 MB download boundary.

**Verification:**

```bash
npm test --workspace @medbuddy/platform -- --run telegram
npm audit --omit=dev
```

**Dependencies:** A1

**Estimated scope:** Medium, 3–5 files

### Checkpoint A — Fictional Telegram boundary proof

- All existing tests and checks pass.
- A local synthetic webhook harness accepts `/status` for the allowlisted fictional test group.
- Invalid secrets, chats, and duplicate updates create no state or response.
- No real health information has been introduced.

### Phase B — Live-data safety boundary

#### B1 — Add the verified, idempotent webhook

Expose the Cloud Run route, verify Telegram's secret header, enforce the allowlisted group, persist update deduplication metadata, and return quickly before background work.

**Acceptance:**

- Replayed updates produce no duplicate action.
- Unknown chats and invalid secrets fail closed.
- HTTP errors and logs contain no message content or Telegram identity.

**Verification:**

```bash
npm test --workspace @medbuddy/web -- --run telegram-webhook
npm run build --workspace @medbuddy/web
```

**Dependencies:** A1, A3

**Estimated scope:** Medium, 3–5 files

#### B2 — Implement activation, consent, and membership blocking

Add `/enable`, `/consent`, `/status`, `/privacy`, and `/pause`. Record the approved membership snapshot and stop processing after joins, leaves, or unresolved membership state.

**Acceptance:**

- Pre-consent messages and blocked-period messages are never processed later.
- Both adults consent before capture starts.
- Membership changes pause all health processing and output until resolved.

**Verification:**

```bash
npm test --workspace @medbuddy/care-record -- --run telegram-consent membership
npm test --workspace @medbuddy/web -- --run telegram-commands
```

**Dependencies:** A2, B1

**Estimated scope:** Medium, 3–5 files

#### B3 — Implement retention and deletion

Add retention metadata and idempotent deletion for media, candidates, facts, handoffs, participant data, and workspaces. State clearly what cannot be removed from Telegram.

**Acceptance:**

- Raw media and unreviewed candidates expire after 30 days.
- Reviewed facts and handoffs expire after 180 days.
- `/delete_my_data` and `/delete_workspace` remove MedBuddy-controlled data without content-bearing logs.

**Verification:**

```bash
npm test --workspace @medbuddy/contracts -- --run retention
npm test --workspace @medbuddy/platform -- --run retention deletion
```

**Dependencies:** A2

**Estimated scope:** Medium, 3–5 files

#### B4 — Complete deployment security and privacy controls

Add Secret Manager wiring, private storage lifecycle, least-privilege IAM, log redaction, cost limits, privacy policy, and a Java 21+ Firestore emulator verification path. Triage every reachable high dependency advisory.

**Acceptance:**

- No secrets exist in source, Terraform state output, logs, or build artifacts.
- Firestore emulator parity tests execute rather than skip.
- The bot privacy policy accurately describes Telegram, Vertex, storage, retention, deletion, and limitations.

**Verification:**

```bash
npm ci --ignore-scripts
npm run check
npm test
npm audit --omit=dev
make infra-plan
```

**Dependencies:** B1, B3

**Estimated scope:** Split into focused security, emulator, and privacy-policy commits; each 3–5 files

### Checkpoint B — Approval to introduce real family data

- Activation and consent work in the deployed private fictional test group.
- Membership changes visibly pause processing.
- Retention and deletion have automated proof.
- Logs, traces, screenshots, and test artifacts contain no content.
- Dependency and emulator blockers are resolved or explicitly accepted with a dated mitigation.
- The workspace steward explicitly approves live use.

No real family health data may enter the bot before this checkpoint passes.

### Phase C — First product-value slice

#### C1 — Connect text capture end to end

Wire an eligible Telegram message through normalized persistence, Cloud Tasks, the existing capture processor, strict proposal validation, and candidate-fact persistence.

**Acceptance:**

- A synthetic observation creates atomic subject-linked, contributor-attributed candidates.
- Provider failure, malformed output, and empty extraction remain visible and retryable without duplicate facts.
- A successful retained candidate produces exactly one `👀` reaction.

**Verification:**

```bash
npm test -- --run telegram-text-capture
npm test --workspace @medbuddy/intelligence -- --run capture injection
```

**Dependencies:** B2, B4

**Estimated scope:** Split into orchestration and outbound-reaction tasks; each 3–5 files

#### C2 — Add contributor review in Telegram

Implement `/review` and compact inline actions for confirm, correct, reject, and uncertain.

**Acceptance:**

- Contributors may act only on their own claims.
- Corrections append and preserve originals.
- Callback retries are idempotent and unauthorized actions fail closed.

**Verification:**

```bash
npm test -- --run telegram-review
npm test --workspace @medbuddy/care-record -- --run review corrections
```

**Dependencies:** C1

**Estimated scope:** Medium, 3–5 files

#### C3 — Add timeline and pre-visit brief

Implement `/timeline [window]` and `/prepare_visit [window]` over reviewed facts, visible uncertainty, conflicts, source references, and unresolved questions.

**Acceptance:**

- The default brief covers 14 days and states its range.
- Every material statement traces to a source fact and message.
- The brief excludes rejected facts and clearly labels uncertainty or incompleteness.

**Verification:**

```bash
npm test -- --run telegram-pre-visit-golden-path
npm test --workspace @medbuddy/care-record -- --run handoff timeline
```

**Dependencies:** C2

**Estimated scope:** Medium, 3–5 files

### Checkpoint C — First demonstrated product value

- A natural fictional Telegram observation becomes a reviewed fact.
- `/prepare_visit 14d` produces a useful, source-linked brief inside Telegram.
- The family manually evaluates clarity, interruption level, attribution, and usefulness.
- Feedback changes the workflow before media scope begins.

### Phase D — Documents and after-visit value

#### D1 — Ingest Telegram media safely

Admit supported images and documents, verify size and content type, store private bytes with checksums and retention, and pass bounded content to multimodal extraction.

**Acceptance:**

- Oversized, unsupported, spoofed, or failed downloads create no retained artifact.
- Files use workspace/message-scoped private paths and expire after 30 days.
- A skin photo records the artifact and reporter description without producing a diagnosis.

**Verification:**

```bash
npm test -- --run telegram-media
npm test --workspace @medbuddy/platform -- --run storage telegram
```

**Dependencies:** C3

**Estimated scope:** Split download/admission and model-input work; each 3–5 files

#### D2 — Draft and review after-visit communication

Implement `/after_visit` over recent supplied documents, reports, and reviewed facts. Preserve document text, caregiver reports, AI organization, uncertainty, and source links as different provenance.

**Acceptance:**

- The draft requires confirmation before becoming a handoff.
- Medication and treatment changes are reported, never recommended.
- Missing, conflicting, or unreadable content remains visible.

**Verification:**

```bash
npm test -- --run telegram-after-visit
npm test --workspace @medbuddy/intelligence -- --run readable-label medication-refusal
```

**Dependencies:** D1

**Estimated scope:** Medium, 3–5 files

### Phase E — Real conversational agent and rollout

#### E1 — Add source-grounded mentioned conversation

Replace the fixed acknowledgement for Telegram with a bounded conversational agent that has read-only timeline, fact, and document tools. Keep medical refusal and canonical writes outside model authority.

**Acceptance:**

- Mentions and direct replies receive natural, context-aware responses.
- Factual claims cite approved workspace sources or state that the record is insufficient.
- Prompt injection cannot grant access, mutate facts, reveal secrets, or bypass safety routing.

**Verification:**

```bash
npm test -- --run telegram-conversation
npm test --workspace @medbuddy/intelligence -- --run conversation injection medication-refusal
```

**Dependencies:** C3, D2

**Estimated scope:** Medium, 3–5 files

#### E2 — Run the one-family alpha

Deploy the approved build, activate the real private group, monitor metadata-only health, and collect anonymized product feedback without copying family content into the repository.

**Acceptance:**

- Both adults complete disclosure and consent themselves.
- The bot remains useful and non-intrusive during ordinary use.
- The family chooses whether to keep it after one week and records only anonymized workflow findings.

**Verification:**

- Complete the live-use runbook outside repository artifacts containing health data.
- Confirm deletion and pause controls manually with non-sensitive content first.
- Record product decisions, not raw conversations.

**Dependencies:** E1 and explicit Checkpoint B approval

**Estimated scope:** Operational checkpoint, not an unattended implementation task

## 6. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Passive access surprises a participant | High | Plain disclosure, individual active consent, `/status`, `/privacy`, and membership fail-close. |
| Child health data leaks into public artifacts | High | Runtime-only data, log redaction, synthetic tests, pre-commit privacy review, no live screenshots. |
| Model invents or medicalizes an observation | High | Strict proposals, provenance, review, deterministic refusals, no diagnosis from photos. |
| Telegram cannot provide complete membership history | High | Start with a new allowlisted group, use service updates, snapshot approval, and pause on uncertainty. |
| Telegram retains its own cloud history | Medium | Disclose clearly; deletion promises cover only MedBuddy-controlled copies. |
| Bot becomes noisy | Medium | Reactions for passive capture; text only on command, mention, direct reply, or narrow escalation. |
| Infrastructure work delays value again | High | Stop after each vertical checkpoint; no multi-tenant or channel-general platform work. |
| Existing dependency advisories affect live data | High | Reachability triage and remediation before Checkpoint B. |
| Family workflow is not actually useful | High | Evaluate immediately after the pre-visit brief and prioritize observed friction over planned scope. |

## 7. Cut Order

If time or complexity grows, cut in this order:

1. Rich conversational personality.
2. Documents other than JPEG/PNG/WebP.
3. `/after_visit` formatting variants.
4. `/timeline` formatting options.
5. Automated urgent-language response beyond medication-decision refusal.

Do not cut consent, membership blocking, provenance, review, retention, deletion, log redaction, or the source-linked pre-visit brief.

## 8. Definition of Done

Every implementation task:

- satisfies its acceptance criteria;
- adds or updates deterministic tests;
- passes `npm run check` and affected test suites;
- introduces no real family data, secrets, or content-bearing logs;
- documents external configuration and failure behavior;
- receives human review at its checkpoint; and
- merges through a feature PR with preserved commit history.

The family alpha is not complete merely because the bot is online. It is complete when the safe vertical path works and the participating family finds enough repeated value to keep using it.
