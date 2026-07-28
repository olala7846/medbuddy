# MedBuddy Product Requirements Document

**Status:** Approved

**Version:** 1.0

**Date:** 2026-07-27

**Canonical language:** English

**First market:** Taiwan

**Primary depth area:** Caregiver workflows

## 1. Executive Summary and Product Thesis

MedBuddy helps a remote adult child and a mostly independent older parent turn incomplete post-visit information into an attributed, reviewable handoff. It does not recover a lost clinical conversation or replace authoritative health records. It organizes the evidence available after a visit, distinguishes what is known from what is reported or unresolved, and helps the family identify appropriate professional follow-up.

The first-market wedge is a recurring, consequential failure to reconstruct and share medical instructions after an older adult attends an outpatient visit without the adult child. The cause may include hearing difficulty, another disability, memory or comprehension limits, embarrassment, face-saving, deference, or family communication patterns. Families qualify through the observed failure, not a diagnosis or demographic label alone.

The sole primary user is the adult child who already coordinates family health information remotely. The older adult is the health-information owner, principal beneficiary, active participant, consent holder, and final health decision-maker. MedBuddy must create value for the adult child without transferring authority away from the older adult.

The product thesis is:

> A consented shared conversation with a provenance-preserving handoff will help families understand and coordinate post-visit care more reliably than fragmented calls, messages, photos, and memory, while preserving the older adult's autonomy.

This thesis is not yet validated with external target families.

## 2. Primary User and First-Market Cell

### Primary user

A digitally capable adult child, approximately 35-50, who:

- lives in a Taiwanese metropolitan area apart from their parents;
- already coordinates some family health information through calls, LINE, and medication photos;
- has a mostly independent older parent who attends some visits without them; and
- has repeatedly needed to reconstruct incomplete post-visit information.

### Qualifying event

A mostly independent older adult attends an outpatient visit without the remote adult child, then cannot or does not provide a sufficiently complete account of the instructions. The family reconstructs the event through calls, messages, photos, or multiple relatives, leaving a meaningful medication or follow-up question unresolved.

### Market context

- Taiwan's 2026 resident-population statistics report that 19.2% of residents are at least 65 years old and 71.7% live in the six municipalities. This supports a focused urban family segment rather than a generic "older adult" market. **Evidence: authoritative market fact.** [Taiwan National Statistics](https://www.stat.gov.tw/News_Content.aspx?n=3703&s=235805)
- People insured by Taiwan NHI may choose among contracted hospitals, clinics, and pharmacies. Multi-provider access makes cross-provider and family communication worth investigating. **Evidence: authoritative market fact.** [NHIA](https://www.nhi.gov.tw/en/cp-1065-d7cde-125-2.html)
- My Health Bank already provides personal health and medication records. MedBuddy therefore addresses comprehension, behavior, observation, uncertainty, and handoff rather than claiming records do not exist. **Evidence: authoritative market fact.** [NHIA My Health Bank](https://www.nhi.gov.tw/en/cp-562-2313c-22-2.html)
- LINE reports more than 22 million users in Taiwan. This supports evaluating LINE as a delivery channel, but it does not prove adoption or usability in the target segment. **Evidence: company-reported market fact; product inference remains unvalidated.** [LINE Taiwan](https://tw.linebiz.com/service/display-solutions/line-ads-platform/)

## 3. Participant Roles

| Role | Product role | Authority and boundary |
| --- | --- | --- |
| Adult child | Sole primary coordinating user | Organizes the handoff, reviews unresolved items, and may complete professional follow-up; cannot make health or medication decisions for the older adult. |
| Older adult | Health-information owner, principal beneficiary, active participant | Controls record creation, group sharing, revocation, corrections to their own reports, and final health decisions. |
| Spouse or other family caregiver | Authorized participant and observer | May contribute and confirm their own observations or follow-up reports; cannot rewrite another person's account. |
| Pharmacist | Trusted medication-information source and escalation endpoint | May review an owner-approved handoff; has no required account or active prototype workflow. |
| Clinician or clinic staff | Source of patient-specific instruction and escalation endpoint | May review an owner-approved handoff; has no required account or active prototype workflow. |
| Emergency service | Urgent escalation endpoint | Receives no MedBuddy account or automated handoff in the prototype. |
| MedBuddy | Conservative facilitator | Captures candidate facts, organizes attributed information, exposes uncertainty, refuses medical decisions, and escalates risk. |

Each shared MedBuddy conversation has exactly one health-information owner. Proxy, guardianship, and legal-representative consent are outside the prototype scope.

## 4. Problem Statement and Evidence

### Problem

After a visit, the clinical conversation may already be unavailable. The older adult may have a medication bag but only a partial account of what the clinician said, why the medication was prescribed, how long it should be used, or what requires follow-up. Remote family members reconstruct events through LINE, calls, photos, and competing recollections. The result is not necessarily a missing record; it is an inability to understand, attribute, verify, and act on the available information.

### Why current workarounds fail

- Calls and messages depend on accurate hearing, memory, interpretation, and retelling.
- Medication-bag photos identify dispensed items but do not preserve patient-specific reasoning or unresolved questions.
- Family members hold different fragments with no shared provenance.
- General drug searches cannot establish why a clinician prescribed a medicine to this patient.
- Authoritative health records complement but do not necessarily capture what the person understood, took, stopped, felt, observed, or clarified later.

### Evidence ledger

| Claim | Evidence status |
| --- | --- |
| A motivating family has experienced post-visit reconstruction failure across hospital and clinic care. | Founder evidence; anonymized. |
| The older adult responds better to information traceable to professionals or authoritative sources. | Founder evidence; hypothesis requiring target-family validation. |
| Similar adult children identify as health-information coordinators. | Hypothesis requiring validation. |
| The qualifying failure is painful enough to cause repeat use. | Hypothesis requiring validation. |
| A shared AI conversation is acceptable to older adults and families. | Hypothesis requiring validation. |
| Consent and provenance can prevent collaboration from feeling like surveillance. | Hypothesis requiring validation. |
| Actual target-family feedback has changed the product. | No evidence; user feedback is pending. |

## 5. Current Workflow and Failure Points

1. The older adult attends a clinic or hospital visit without the remote adult child.
2. Instructions are delivered verbally and may be supplemented by a medication bag or written material.
3. At home, the older adult shares an incomplete account or medication photo.
4. Family members ask follow-up questions through calls or LINE.
5. Different participants introduce memories, observations, searches, and assumptions.
6. No artifact distinguishes original material, reported instruction, general reference, family observation, and AI organization.
7. A relative may contact a clinic or pharmacist, but the clarification is not reliably connected to the original uncertainty.
8. Between visits, symptoms and medication behavior remain fragmented.

The main failure points are lost context, unattributed claims, unresolved conflicts, untracked follow-up, and family assistance that can drift into surveillance or decision takeover.

## 6. Product Principles

1. **Facts before interpretation.** Capture attributable facts and preserve uncertainty; never speculate to complete a record.
2. **Autonomy before convenience.** No persistent patient-specific record exists without the health-information owner's consent.
3. **Conversation for capture, structure for review.** Chat is the collaboration surface; the canonical artifact is a structured handoff.
4. **Provenance is product behavior.** Source type, contributor, event time, entry time, review status, and conflicts remain visible.
5. **General reference is not patient-specific instruction.** Medication identity cannot establish diagnosis, purpose, timing, or duration for this patient.
6. **Escalate rather than decide.** MedBuddy refuses diagnosis, prescribing, and medication-change decisions.
7. **Accessible, not audio-dependent.** The complete P0 flow works through readable text, images, structured prompts, and manual correction.
8. **Collaboration is not surveillance.** Processing, sharing, membership, and revocation states are explicit.
9. **Complement authoritative records.** MedBuddy captures outside-care context without competing as a medication-record database.
10. **Prototype the thesis, not infrastructure.** Reuse the fastest suitable conversation primitive; do not build a general chat system.

## 7. End-to-End User Journey

### Setup and consent

1. A family starts a shared MedBuddy conversation for one health-information owner.
2. The owner consents to recording their health information.
3. Every participant consents to MedBuddy processing their messages.
4. MedBuddy displays the current member list.
5. The owner approves sharing with that membership snapshot.
6. MedBuddy shows that it is ready and explains `👀`, `@MedBuddy`, passive processing, revocation, and third-party retention limits.

### Post-visit capture

1. The owner or caregiver describes the visit and adds available images or written material.
2. MedBuddy reacts with `👀` only to candidate health-related facts.
3. Family members discuss what is known, missing, or conflicting.
4. MedBuddy replies textually only when `@mentioned`, except for deterministic high-risk escalation.

### Handoff creation

1. A participant explicitly asks MedBuddy to create a post-visit handoff.
2. MedBuddy groups candidate facts by visit context, medication, instruction, source, uncertainty, and follow-up.
3. Participants review candidates in a batch.
4. Each contributor accepts or corrects extraction of their own statements.
5. Conflicting accounts remain separately attributed.
6. Unreviewed or unresolved items stay visibly labeled.
7. The canonical handoff becomes available in concise conversation and review/export views.

### Professional follow-up

1. The owner or caregiver contacts a pharmacist, clinic, or emergency service as appropriate.
2. The participant records the reported clarification.
3. MedBuddy labels it as self-attested follow-up, including who contacted whom, when, and what they report hearing.
4. The original uncertainty remains in history; the clarification is appended.

### Later event

1. The owner reports a symptom or adherence event, or a caregiver records an observation.
2. MedBuddy preserves reporter, event time, entry time, uncertainty, and review status.
3. A participant explicitly updates the handoff.
4. The updated artifact retains the earlier version and does not infer causality.

### Membership change or revocation

1. A membership delta invalidates owner approval.
2. MedBuddy hard-blocks health processing and output.
3. MedBuddy identifies the missing consent or approval.
4. Processing resumes only after the owner approves all current members or unapproved members leave.
5. Revocation stops future MedBuddy access and processing within its control; third-party chat history and copies remain subject to the external platform.

## 8. MVP Scope and Priorities

### P0: Required for the 48-hour prototype

- One-owner, multi-participant consent and membership approval.
- Deterministic hard block for incomplete access control.
- Passive health-fact capture with `👀`.
- Explicit `@MedBuddy` response contract and high-risk exception.
- Text, image, and manual factual input.
- Grounded medication information with patient-specific versus general separation.
- Explicitly invoked handoff creation.
- Batched, provenance-scoped review.
- Canonical conversation and review/export views.
- Unknown and conflict handling.
- Self-attested professional follow-up.
- One later attributed event and history-preserving handoff update.
- Medication-decision refusal and risk escalation.
- Accessible, non-audio-dependent presentation.

### P1: After the P0 thesis is demonstrated

- Multi-event patient timeline.
- Filtering and factual before-visit agenda.
- Refined caregiver collaboration based on target-family feedback.
- Professional presentation changes based on pharmacist or clinician review.

### P2 or future

- Real LINE group integration.
- Recording and transcription.
- Trend interpretation and cross-visit analytics.
- Confidence-based autonomous participation.
- Automated clinical pattern detection.
- Proxy or legal-representative consent.

## 9. Product Requirements

Priority definitions: **P0** is required for the 48-hour prototype; **P1** follows validation; **P2** is stretch or future.

Evidence abbreviations: **BCR** binding challenge requirement; **CPD** confirmed product decision; **FE** founder evidence; **HYP** hypothesis requiring validation; **UF** actual user feedback.

### Consent and access

| ID | User pain or safety obligation | Requirement | Priority | Acceptance criterion | Evidence |
| --- | --- | --- | --- | --- | --- |
| CONS-001 | Family coordination must not create a record without the owner's knowledge. | MedBuddy must not persist patient-specific health information until the owner gives recognized consent. | P0 | In a new group, a health message sent before owner consent creates no patient record or candidate fact. | CPD |
| CONS-002 | User-facing consent must be deterministic and respectful. | The owner must establish the workspace using `@MedBuddy 我同意記錄我的健康資訊` or `@MedBuddy I consent to MedBuddy recording my health information`. | P0 | Each recognized phrase establishes its sender as the sole owner; other phrases do not. | CPD |
| CONS-003 | Every participant's messages are processed. | Each participant must consent before MedBuddy processes that participant's messages. | P0 | Before consent, the participant's message receives no `👀`, fact extraction, or answer except a consent instruction. Earlier messages are not processed later. | CPD |
| CONS-004 | Processing consent is not permission to see the owner's health data. | The owner must approve sharing with the displayed current membership snapshot. | P0 | `@MedBuddy 我同意群組分享` or `@MedBuddy I consent to group sharing` approves only the displayed current members. | CPD |
| CONS-005 | New members must not silently gain MedBuddy health access. | Any membership delta must hard-block all health processing and output until access is resolved. | P0 | While blocked, MedBuddy produces no `👀`, health facts, answers, handoffs, or health escalation; it posts an immediate block notice stating that safety monitoring is also paused and repeats it only on MedBuddy interactions or incomplete consent actions. | CPD |
| CONS-006 | Consent persists but remains revocable. | Approved sharing must persist until revoked; revocation must stop future MedBuddy-controlled processing and access. | P0 | After revocation, the recipient receives no new MedBuddy health output; the UI states that prior external chat history, exports, or copies cannot be recalled. | CPD |

### Conversational participation and accessibility

| ID | User pain or safety obligation | Requirement | Priority | Acceptance criterion | Evidence |
| --- | --- | --- | --- | --- | --- |
| CHAT-001 | Passive capture must be visible and predictable. | MedBuddy must use only `👀` to acknowledge a candidate health-related fact. | P0 | Health-fact test messages receive `👀`; unrelated messages receive no reaction; no other automated emoji is used. | CPD |
| CHAT-002 | Emoji must not imply verification or safety. | The product must explain that `👀` means "captured for review." | P0 | In usability testing, participants can state that `👀` does not mean verified, safe, or clinically important. | CPD, HYP |
| CHAT-003 | The agent must not intrude unpredictably. | Text replies must require `@MedBuddy`, except for a deterministic high-risk trigger. | P0 | Non-urgent, unmentioned messages receive no text reply; mentioned questions receive a reply; high-risk fixtures receive escalation without mention. | CPD, BCR |
| ACC-001 | Hearing or audio availability must not block the core workflow. | Every P0 action and critical message must be usable through readable text, images, structured controls, and manual correction. | P0 | The end-to-end acceptance scenario completes with audio disabled. | BCR, CPD |
| ACC-002 | Older adults must use the workflow without a walkthrough. | Critical consent, source, uncertainty, sharing, and escalation states must use plain, readable language and redundant non-color cues. | P0 | A target participant can identify each state without facilitator explanation; visual state does not rely on color alone. | BCR, HYP |

### Capture, provenance, and handoff

| ID | User pain or safety obligation | Requirement | Priority | Acceptance criterion | Evidence |
| --- | --- | --- | --- | --- | --- |
| PROV-001 | Family members currently mix incompatible evidence. | Every candidate and canonical fact must retain source type, contributor, event time when known, entry time, and review status. | P0 | The handoff exposes those fields for every fixture fact and never displays an unattributed fact. | CPD |
| PROV-002 | MedBuddy cannot recover a lost conversation. | The product must label original material, patient report, caregiver observation, reference fact, self-attested follow-up, and AI-organized candidate distinctly. | P0 | A mixed-source fixture displays all source classes correctly and never labels recollection as original instruction. | BCR, CPD |
| PROV-003 | Contributors must not overwrite one another. | Confirmation authority must follow provenance. | P0 | A caregiver can correct their own observation but cannot modify the owner's statement; a conflicting caregiver account is appended separately. | CPD |
| HAND-001 | Chat history is not a usable family source of truth. | A participant must explicitly invoke handoff creation or update. | P0 | No canonical handoff is created automatically; a recognized request produces a proposed handoff. | CPD |
| HAND-002 | Immediate confirmation would make conversation burdensome. | MedBuddy must batch candidate review during handoff creation or update. | P0 | Multiple `👀` candidates appear in one review flow; each can be accepted, corrected, rejected, or marked uncertain. | CPD, HYP |
| HAND-003 | Incomplete information must remain useful without appearing complete. | The handoff must include visit identity, attributed account, medication facts, evidence, unresolved items, and follow-up status on a best-effort basis. | P0 | A fixture with missing duration produces a shareable handoff that prominently shows duration as unresolved. | BCR, CPD |
| HAND-004 | Families and professionals need the same facts at different densities. | The canonical handoff must support a concise conversation view and a denser review/export view without changing provenance or status. | P0 | Both views contain identical underlying fixture facts, sources, conflicts, and unresolved states. | BCR, CPD |
| HAND-005 | Later clarification must not rewrite history. | Updates must append clarification and preserve the prior uncertainty and evidence. | P0 | After a follow-up update, the original unresolved item and later clarification remain traceable. | CPD |

### Medication information, uncertainty, and safety

| ID | User pain or safety obligation | Requirement | Priority | Acceptance criterion | Evidence |
| --- | --- | --- | --- | --- | --- |
| MED-001 | Families need medication context but image matching may be uncertain. | MedBuddy must identify medication only when sufficient grounded evidence exists; otherwise it must keep identity unresolved and request better factual input. | P0 | An ambiguous fixture produces no asserted identity; a clear label fixture displays the identity and source. | BCR, CPD |
| MED-002 | General use does not establish patient-specific purpose. | General purpose and caution information must cite an identifiable authoritative reference and remain labeled general. | P0 | Reference content includes a source link and never uses wording equivalent to "your doctor prescribed this for." | BCR, CPD |
| MED-003 | Timing and duration are patient-specific. | MedBuddy must take timing and duration only from written material or attributed instruction, not generic reference data. | P0 | A reference-only fixture leaves patient timing and duration unresolved. | BCR, CPD |
| MED-004 | Families need interaction context, but incomplete inputs and references can create false reassurance. | For an identified medication, MedBuddy must present only interaction considerations supported by an identifiable reference, state that the information is general and non-exhaustive, and direct patient-specific questions to a pharmacist or clinician. | P0 | A known-interaction fixture displays the consideration and source; a no-result or incomplete-medication-list fixture displays limitations and never claims that no interaction exists. | BCR, CPD |
| SAFE-001 | Conflicting schedules can cause harm. | MedBuddy must preserve conflicts and refuse to select an instruction autonomously. | P0 | A before-meal versus after-meal fixture displays both sources, marks conflict, and directs professional clarification without choosing one. | BCR, CPD |
| SAFE-002 | Users may ask whether to change medication. | MedBuddy must acknowledge the report, refuse the medication decision, avoid causal claims, and route appropriate follow-up. | P0 | "Should I stop?" fixtures never produce start, stop, continue, or dose advice and do create an attributed question and follow-up item. | BCR, CPD |
| SAFE-003 | Potentially urgent symptoms require immediate escalation. | A deterministic high-risk rule may interrupt without mention and must direct appropriate immediate human or emergency help while stating MedBuddy cannot assess the condition. | P0 | High-risk fixtures receive an unsolicited escalation; ordinary symptom fixtures do not receive emergency language unless mentioned. | BCR, CPD |
| SAFE-004 | Missing reference warnings must not create false reassurance. | MedBuddy must not state that a medication or situation is safe merely because no grounded warning was found. | P0 | No-result fixtures communicate limitation and uncertainty rather than safety. | BCR, CPD |

### Follow-up and longitudinal continuity

| ID | User pain or safety obligation | Requirement | Priority | Acceptance criterion | Evidence |
| --- | --- | --- | --- | --- | --- |
| FUP-001 | Professional follow-up currently disappears into family chat. | Self-attested follow-up must preserve caller, contacted party, contact time, reported clarification, and entry author. | P0 | A caregiver call fixture displays every field and is labeled reported, not clinic-verified. | CPD |
| LOG-001 | Symptoms and medication behavior occur between visits. | The prototype must capture one later attributed symptom, adherence report, or caregiver observation and update the handoff without inferring causality. | P0 | The later-event fixture retains reporter and time, updates the handoff, and makes no causal statement. | BCR, CPD |
| LOG-002 | Families may need a factual before-visit history. | P1 must support a multi-event timeline, filtering, and factual agenda without diagnosis or treatment recommendation. | P1 | A future acceptance scenario generates an attributed agenda from multiple events with unresolved questions and no diagnostic inference. | BCR, CPD, HYP |

## 10. Trust, Consent, Privacy, Provenance, and Sharing Boundaries

### Deterministic consent commands

| Purpose | Traditional Chinese | English |
| --- | --- | --- |
| Establish health-information owner | `@MedBuddy 我同意記錄我的健康資訊` | `@MedBuddy I consent to MedBuddy recording my health information` |
| Approve current group sharing | `@MedBuddy 我同意群組分享` | `@MedBuddy I consent to group sharing` |

Short commands are valid only after MedBuddy displays the relevant explanation and current membership snapshot.

### Third-party messaging boundary

If the delivery surface is LINE or another external platform:

- MedBuddy controls only its own processing, records, and responses.
- The platform may retain chat history and copies outside MedBuddy.
- MedBuddy revocation cannot delete content already exposed through the platform.
- If membership cannot be detected reliably, the platform cannot support passive P0 processing under this consent contract.

### Privacy requirements

- Collect only information required for the handoff and evaluation.
- Do not place real participant PII or sensitive health details in the public repository.
- Use fictional or de-identified fixtures in demonstrations and tests.
- Do not represent a participant's message as consent unless it matches a supported deterministic command after disclosure.
- Do not retrospectively process pre-consent messages.
- Do not expose patient-specific output during an access-control block.

## 11. Medical-Safety Requirements and Escalation

### Allowed behavior

- Organize and attribute user-supplied facts.
- Present grounded general medication reference information with sources and limitations.
- Ask for better evidence.
- Preserve uncertainty and conflicts.
- Suggest contacting a pharmacist, clinic, treating professional, or emergency service according to risk level.
- Record what a participant reports learning from professional follow-up.

### Prohibited behavior

- Diagnose or rule out a condition.
- Prescribe or recommend a medication or dose.
- Recommend starting, stopping, continuing, or changing treatment.
- Infer why a clinician prescribed a drug.
- Assert that medication caused or did not cause a symptom.
- Resolve conflicting patient-specific instructions.
- State that no interaction or danger exists merely because no reference result was found.

### Escalation levels

| Level | Trigger | Product behavior |
| --- | --- | --- |
| Unresolved | Missing identity, duration, purpose, timing, or conflicting account without urgent risk | Preserve uncertainty and direct the owner or caregiver to a pharmacist or clinic. |
| Prompt professional follow-up | Medication-decision request or concerning non-emergency symptom | Refuse the decision, record the question, and recommend prompt contact with the prescribing clinic or pharmacist. |
| Urgent | Deterministic high-risk symptom or immediate medication-risk fixture | Interrupt without mention, state inability to assess, and direct immediate human or emergency help. |

The TDD will define trigger sources, implementation, evaluation, and false-positive handling. The PRD requires the observable behaviors above.

## 12. Success Metrics and Evaluation Plan

### Primary value metric

At least two of the initial two or three matched families voluntarily use MedBuddy after a second real or realistically simulated care event.

This is an initial learning threshold, not a statistically generalizable market result.

### Required safety and comprehension gates

A family counts as a successful validation only if participants can:

- explain that `👀` means captured for review, not verified or safe;
- distinguish written, reported, observed, reference, self-attested follow-up, and unresolved information;
- explain who can see the handoff and what revocation cannot retract;
- create or update a handoff without the caregiver taking over the owner's decisions;
- identify appropriate professional follow-up for an unresolved item; and
- state that MedBuddy does not diagnose or decide medication changes.

Failure on any critical safety gate prevents the family from counting as a successful result even if they reuse the product.

### Supporting observations

- Time and assistance needed to complete consent.
- Number and type of candidate facts accepted, corrected, rejected, or left uncertain.
- Whether the structured handoff reveals a meaningful gap or reduces conflicting reconstruction.
- Whether the owner feels supported, neutral, or monitored.
- Whether participants understand the group-membership hard block.
- Whether passive AI participation is accepted, muted, or rejected.

## 13. User-Research and Prototype-Validation Plan

### Participants

Recruit two or three families matching all of these criteria:

- a mostly independent older adult;
- an adult child living separately;
- an existing adult-child role in health-information coordination;
- at least one recurring or consequential post-visit reconstruction failure; and
- willingness for both the older adult and adult child to participate.

The motivating family may participate, but it must not be presented as external validation.

### Session sequence

1. Observe consent and group setup without a walkthrough.
2. Run a realistic post-visit scenario using fictional or participant-approved de-identified material.
3. Observe conversation, `👀` interpretation, handoff invocation, and batched review.
4. Introduce an unresolved or conflicting medication instruction.
5. Observe appropriate professional-follow-up selection.
6. Add a later attributed event and update the handoff.
7. Introduce a membership delta and observe access-control comprehension.
8. Repeat with a second event in the same or a follow-up session.

### Evidence capture

Record only de-identified product-relevant behavior:

- what participants understood;
- what they ignored;
- what they rejected;
- what they corrected;
- where they needed help;
- whether they chose to reuse the workflow; and
- what changed in the prototype as a result.

Never fabricate feedback or commit raw identifiable transcripts.

### Rejection criteria

- One matched family's rejection triggers investigation.
- The same rejection in at least two matched families triggers review of the relevant interaction model or thesis.
- If families value the handoff but reject passive listening, test explicit forwarding, form-assisted capture, or `@MedBuddy`-only processing.
- If families reject the structured handoff because existing calls, photos, messages, and authoritative records are sufficient, reconsider the core thesis.

## 14. Explicit Non-goals

The initial product will not:

- diagnose, prescribe, or make autonomous medical decisions;
- recommend medication or dose changes;
- infer unsupported causality;
- perform comprehensive interaction checking;
- guarantee medication recognition;
- guarantee recording or transcription;
- require active clinician or pharmacist participation;
- build a clinician dashboard, inbox, or monitoring service;
- compete with My Health Bank as a medication-record database;
- build a general-purpose chat application;
- depend on LINE for the product thesis;
- provide full longitudinal analytics in P0;
- solve every accessibility or cultural communication problem;
- support multiple health-information owners in one group;
- implement proxy or legal-representative consent; or
- retract third-party chat history, exports, or copies.

## 15. 48-Hour Prototype Scope

### Scenario to prove

1. An older adult and adult child establish a fully consented group.
2. The older adult returns from a visit with a medication bag and incomplete recollection.
3. The family contributes facts through text and images.
4. MedBuddy uses `👀` to acknowledge candidate health facts.
5. The family explicitly invokes and reviews a structured handoff.
6. Medication identity and reference information appear only when grounded.
7. Missing duration or conflicting timing remains unresolved.
8. The adult child records a self-attested pharmacist or clinic clarification.
9. A later symptom, adherence report, or caregiver observation updates the handoff without causal inference.
10. A medication-decision question receives refusal and professional escalation.
11. A high-risk fixture produces the deterministic urgent escalation.
12. A membership delta hard-blocks all health processing and output until approval is restored.

### Delivery constraint

Use an existing messaging surface, embeddable conversation primitive, or minimal purpose-built shell, whichever proves the workflow fastest. Do not spend P0 building a full chat application or real LINE integration.

### Prototype pass condition

The scenario is runnable end to end, every P0 requirement has an observable demonstration or automated test, and the experience works with audio disabled.

## 16. 12-Week and Six-Month Vision

### 12 weeks

- Validate repeated use across 5-10 closely matched families.
- Determine whether passive shared-conversation capture is accepted or requires a less active interaction model.
- Refine consent and provenance based on observed comprehension.
- Add the P1 multi-event timeline and factual before-visit agenda.
- Obtain pharmacist or clinician feedback on the review/export presentation.
- Evaluate LINE integration only if the product workflow has demonstrated value.

The 12-week thesis succeeds when families repeatedly create useful handoffs without the older adult feeling monitored or losing authority.

### Six months

- Develop a longitudinal family health-collaboration layer.
- Connect outside-care reports and observations to authoritative records without merging their provenance.
- Support reusable, professional-reviewable history across visits.
- Evaluate additional consent relationships and care-team participation.
- Explore grounded trends only with explicit safety boundaries and validation.

The six-month product remains a collaboration layer, not an autonomous care manager.

## 17. Risks, Assumptions, and Unresolved Questions

| Item | Status | Mitigation or decision trigger |
| --- | --- | --- |
| Founder experience may not generalize. | Highest product risk; HYP | Test two or three matched families and require second-event reuse. |
| Broader communication-failure wedge may still be too broad. | HYP | Qualify by the narrow recurring post-visit reconstruction event. |
| Passive processing may feel intrusive. | HYP | Test comprehension and acceptance; pivot to explicit capture if the handoff remains valuable. |
| `👀` may be interpreted as endorsement. | HYP | Use one fixed meaning and make comprehension a safety gate. |
| Group consent may be too noisy or complex. | HYP | Test setup and membership-delta recovery without a walkthrough. |
| A delivery platform may not expose reliable membership events. | Unresolved feasibility question | Reject passive P0 use on that platform or use a controlled surface. |
| LINE may reduce onboarding friction but weaken consent control. | Unresolved delivery hypothesis | Compare with a minimal dedicated shared surface after core workflow completion. |
| Medication data may not support confident identity or cautions. | TDD decision | Preserve unresolved status; select and evaluate authoritative sources in the TDD. |
| Deterministic high-risk rules may over- or under-escalate. | TDD and evaluation risk | Define fixtures, limitations, and evaluation in the TDD; never offer reassurance from no result. |
| Professional review format is unvalidated. | HYP | Obtain pharmacist or clinician feedback after the factual artifact works. |
| Exact retention, deletion, and export policy is undecided. | Product-policy gap before production | Prototype with minimal fictional/de-identified data; decide before real-data deployment. |
| Actual user feedback is absent. | Confirmed gap | Do not claim validation; complete target-family sessions before submission. |

## 18. Challenge-Requirement Traceability

| Challenge requirement | PRD response | Primary requirement IDs |
| --- | --- | --- |
| Older-adult-friendly voice or accessible chat | Complete non-audio accessible conversation and review flow | ACC-001, ACC-002, CHAT-001 |
| Grounded purpose, timing, and interaction considerations | Separate general references from patient-specific evidence and preserve limitations | MED-001, MED-002, MED-003, MED-004, SAFE-004 |
| Structured medication, symptom, and adherence logs | Capture attributed facts and one later event; expand in P1 | PROV-001, LOG-001, LOG-002 |
| Caregiver- or clinician-reviewable summary | One canonical handoff with conversation and review/export views | HAND-003, HAND-004 |
| Escalate uncertainty and risk | Preserve conflicts, refuse decisions, and route human or emergency follow-up | SAFE-001, SAFE-002, SAFE-003 |
| Initial older-adult, caregiver, and clinician workflow | Define owner, primary coordinating user, contributors, and professional endpoints | CONS-001 through CONS-006, FUP-001 |
| Medication-comprehension and handoff wedge | Attributed reconstruction and canonical post-visit handoff | PROV-002, HAND-001 through HAND-005 |
| Broader chronic-care path | P1 timeline and six-month collaboration layer | LOG-002, Section 16 |
| Meaningful depth | Consented caregiver collaboration with provenance-preserving handoff | CONS-001 through CONS-006, PROV-001 through PROV-003 |
| No autonomous medical decisions | Explicit prohibited behavior and deterministic refusal | SAFE-001 through SAFE-004 |

## 19. Appendix: 90-Second Product Pitch

MedBuddy is for the adult child who already helps coordinate an older parent's care from another city. The parent may return from a clinic with a medication bag but only a partial account of what the clinician said. The family then reconstructs the visit through LINE messages, calls, photos, and competing memories.

MedBuddy joins a consented family conversation and turns those fragments into an attributed handoff. It shows what came from written instructions, what the parent or caregiver reported, what a general reference says, and what remains unresolved. The older adult controls sharing and remains the final decision-maker. When the family needs clarification, MedBuddy helps preserve the question and the reported follow-up without pretending that it contacted or verified with the clinic.

This is not another medication database, reminder app, or autonomous medical adviser. Taiwan already has strong health-record infrastructure. MedBuddy captures the complementary outside-care reality: what the person understood, actually did, felt, and shared with family.

The hard part is not generating a summary. It is making family collaboration trustworthy: consent that survives normal use but blocks unsafe membership changes, provenance that prevents AI or family interpretation from becoming clinical fact, and escalation that helps without making a medical decision.

In 48 hours, the prototype proves one complete post-visit handoff and one later update. In 12 weeks, the thesis is voluntary repeated use across 5-10 matched families. In six months, MedBuddy becomes a longitudinal family health-collaboration layer that complements authoritative care records.
