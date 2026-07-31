# MedBuddy Prototype Challenge

> **Historical external brief:** The submission deadline and reviewer-oriented
> deliverables below no longer determine product priority. The medical-safety
> contract remains binding. Current work follows
> [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) and the
> [Telegram family-alpha specification](./docs/TELEGRAM_FAMILY_ALPHA_SPEC.md).

## Original Delivery Constraint (no longer active)

- Deliver within 48 hours of receiving the challenge. If the deadline is at risk, flag it and provide an ETA.
- The main deliverable is a working, runnable prototype with source code.
- Rough is acceptable; a polished document, prompt, or thin LLM wrapper is not sufficient.
- Preserve the full commit history. Do not squash, rebase, or rewrite commits; commit history is part of the submission and will be reviewed.
- Obtain and read the separately referenced prep guide for the prototype, TDD, and panel packet if available; it was not included with the challenge text.

## Product Context

MedBuddy is a voice-friendly medication companion for older adults and their care teams.

Older adults managing multiple medications face confusion, adherence gaps, and fragmented communication with caregivers and clinicians. The product should improve medication understanding, structured logging, and care-team handoffs—not merely send reminders.

## Required Workflow

Build an older-adult-friendly workflow that:

1. Provides a voice-friendly or highly accessible chat experience for medication review.
2. Explains medication purpose, timing, and interaction considerations using grounded reference data and clear limitations.
3. Captures structured medication, symptom, and adherence logs over time.
4. Produces a caregiver- or clinician-reviewable summary.
5. Escalates uncertainty and risk instead of making autonomous medical decisions.

Go meaningfully deeper in at least one area:

- Medication-data grounding
- Voice UX
- Mandarin support
- Caregiver workflows
- Clinician summaries
- Safety escalation
- Longitudinal logging

## Safety Contract

- Ground medication information in identifiable reference data.
- Communicate uncertainty and system limitations clearly.
- Never diagnose, prescribe, or make autonomous medical decisions.
- Escalate potentially dangerous symptoms, interactions, or uncertainty to an appropriate human or emergency resource.

## Original Required Deliverables

- A working end-to-end prototype.
- The exact command or live URL used to run it.
- The exact command used to run its tests.
- A PRD defining the initial older-adult, caregiver, and clinician workflow; the medication-comprehension and handoff wedge; and the path toward a broader chronic-care product.
- A TDD covering grounding, voice or chat architecture, structured logs, summaries, safety boundaries, escalation, evaluation, privacy, and failure modes.
- Source code and all supporting links with reviewer access.

Reviewers will read the PRD and TDD before running and inspecting the prototype.

AI Fund will execute the prototype and test commands before scheduling a panel.

## Original Submission Contract

Provide:

- PRD
- TDD
- Prototype
- Source code
- Access notes and credentials
- What was personally built
- What was reused
- What AI produced and what was rewritten or rejected
- What broke and how it was debugged

Make the repository public or grant reviewer access before the interview. Ensure all document, design, repository, and deployment links are viewable by reviewers.

A ZIP snapshot is only a fallback; advancement pauses until the repository can be verified.

## Original AI Interview

- Complete the required 60-minute voice interview after submitting.
- Start it within 30 minutes of submission.
- Plan for submission and the interview as one sitting.
- The invitation expires 72 hours after the original challenge email, 24 hours after the build deadline.
- Be ready to explain the prototype, decisions, tradeoffs, debugging, PRD, and TDD using exact files, functions, and commands.
- Keep the repository open during the interview; answers will be reconciled against the submitted repository.
- Be prepared to produce a small piece of new logic aloud.
- AI tools may be used for new questions if their use is narrated, but questions about the submitted work must be answered from personal understanding.
