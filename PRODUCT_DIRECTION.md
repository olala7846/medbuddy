# MedBuddy Product Direction

**Status:** Accepted

**Effective date:** 2026-07-31

**Current priority:** Deliver personal family value through a live Telegram agent.

## North Star

MedBuddy should participate in a real, private family group chat and reduce the work required to coordinate care. It should quietly turn ordinary conversation, observations, photos, and visit documents into an attributed timeline, then help the family prepare and communicate before and after appointments.

The first proof is not a polished reviewer demo. It is sustained usefulness to one real family.

## First Live Alpha

The first live workspace is:

- one private Telegram group;
- two consenting adult participants;
- one dependent child represented by a non-identifying alias;
- one adult serving as the technical workspace steward;
- English interaction;
- a passive agent that reacts after capture and otherwise speaks only when mentioned or commanded, except for narrow deterministic urgent-language escalation.

The alpha succeeds when the family can:

1. report observations naturally in the group;
2. see that candidate facts were captured without interrupting the conversation;
3. review, correct, reject, or mark those facts uncertain;
4. request a source-linked timeline and pre-visit brief;
5. share an after-visit document or reported instruction and request a reviewed family summary;
6. ask MedBuddy factual questions about the captured family record; and
7. pause processing, revoke consent, and delete retained data.

## Priority Order

When scope competes, use this order:

1. Privacy, consent, provenance, and medical-safety boundaries.
2. A working Telegram message-to-fact-to-visit-brief path.
3. Usefulness and trust for the participating family.
4. Reliability, deletion, retention, and operational visibility.
5. Images and after-visit documents.
6. Conversational quality and additional channels.
7. Web presentation and external-review polish.

Do not spend time polishing the existing fake-backed web demo unless the work directly enables, tests, or operates the live Telegram path.

## Locked Alpha Decisions

- Telegram is the first channel.
- Existing GCP, Firestore, Cloud Tasks, Cloud Storage, and Vertex foundations remain the target platform.
- One adult is the technical steward; every adult participant must consent independently.
- Any membership change pauses health processing until the steward approves the new snapshot and all participants consent.
- Raw downloaded media expires after 30 days by default.
- Reviewed structured facts expire after 180 days by default unless the workspace is deleted earlier.
- The bot receives only messages posted after activation; it does not claim to reconstruct earlier Telegram history.
- The agent may organize, attribute, summarize, surface uncertainty, and propose follow-up questions.
- The agent must not diagnose, prescribe, infer treatment, decide medication changes, or claim continuous safety monitoring.

## Public Repository Boundary

Real family messages, names, Telegram identifiers, images, documents, health facts, prompts containing those facts, credentials, and model outputs must never enter this repository, fixtures, issues, pull requests, screenshots, test recordings, or logs. Repository evidence remains fictional, synthetic, or irreversibly anonymized.

Real data may be processed only by the explicitly approved private runtime after the live-data safety checkpoint in the implementation plan passes.

## Relationship to the AI Fund Challenge

The original challenge created useful safety and architecture constraints, but its submission deadline and reviewer-oriented deliverables no longer determine implementation priority. The medical-safety contract remains binding. The current product direction, family-alpha specification, and execution roadmap supersede the old presentation plan.

## Canonical Documents

- Product direction: this file
- Family-alpha specification: [`docs/TELEGRAM_FAMILY_ALPHA_SPEC.md`](./docs/TELEGRAM_FAMILY_ALPHA_SPEC.md)
- Implementation roadmap: [`tasks/plan.md`](./tasks/plan.md)
- Executable checklist: [`tasks/todo.md`](./tasks/todo.md)
- Decision record: [`docs/decisions/0001-prioritize-live-telegram-family-alpha.md`](./docs/decisions/0001-prioritize-live-telegram-family-alpha.md)
