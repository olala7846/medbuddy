# MedBuddy PRD Decision Log

**Status:** Stage 1 product intent and Stage 2 adversarial review confirmed

**Confirmed:** 2026-07-27

**Purpose:** Preserve confirmed PRD interview and adversarial-review decisions before PRD drafting

**Inputs:** Prototype challenge, candidate preparation guide, prior product-intent discovery, and the Stage 1 founder interview

> This is a decision log, not the PRD. No external target-family feedback has occurred yet.

## Evidence Labels

- **Binding challenge requirement:** Required by the prototype challenge or its medical-safety contract.
- **Founder evidence:** An anonymized observation or experience supplied by the founder.
- **Confirmed product decision:** Explicitly confirmed during product discovery.
- **Hypothesis requiring validation:** A product belief that must be tested with target families.
- **Actual user feedback:** Evidence from a target user interacting with the product. None has been collected yet.

## Confirmed Stage 1 Intent

- **Outcome:** Turn incomplete post-visit information into a factual, provenance-preserving record that the older adult and authorized family can review, share, and use to identify necessary professional follow-up.
- **Primary user:** A digitally capable adult child living apart from a mostly independent older parent and already helping coordinate health information.
- **Older-adult value:** Recover and review information they may not have fully captured, correct the family's account, control persistent sharing consent, and receive help without surrendering decision authority.
- **Market wedge:** Demonstrated failure to capture and share sufficiently complete medical instructions, whether caused by hearing difficulty, another disability, comprehension or memory limitations, embarrassment, face-saving, deference, or family and cultural communication patterns.
- **Initial interaction hypothesis:** A consented shared conversation among the older adult, an authorized caregiver, and MedBuddy.
- **P0 success:** Complete a best-effort, non-speculative post-visit handoff containing facts, medication information, provenance, unresolved items, professional-follow-up status, older-adult-controlled sharing, and visible safety escalation.
- **P1 direction:** Build a longitudinal timeline of attributed patient reports and caregiver observations that can support a factual before-visit agenda without diagnosing or inferring causality.
- **Primary validation signal:** Voluntary reuse after a second real or realistically simulated care event.

## Roles and Authority

### Adult child

- Is the single primary coordinating user.
- Helps construct the handoff, reviews unresolved items, and may perform follow-up with a pharmacist or clinic.
- Does not gain authority to make health or medication decisions for the older adult.

### Older adult

- Is the principal beneficiary, active participant, consent holder, and final health decision-maker.
- May review, correct, and mark information as uncertain.
- Controls which family members receive persistent access and may revoke future access.

### Clinicians and pharmacists

- Are not active MedBuddy users in the prototype.
- Remain sources of clinical judgment and escalation endpoints.
- May review an older-adult-approved factual summary.
- Do not need accounts, enter data, monitor the family, or approve MedBuddy records.

## Priority and Journey

### P0: Post-visit comprehension and handoff

The core workflow begins immediately after a visit, when the older adult has a medication bag, written material when available, and an incomplete or uncertain recollection.

P0 includes:

- accessible capture and review;
- factual separation of original clinical material, patient recollection, family observation, reported professional follow-up, authoritative reference information, and AI-generated organization;
- grounded medication identity, purpose, timing, and relevant cautions when identifiable data is available;
- explicit handling of unknown or conflicting information;
- older-adult-controlled family sharing;
- a concise family- and professional-reviewable handoff;
- risk and uncertainty escalation; and
- a minimal structured symptom, medication, and adherence event log.

### P1: Asynchronous patient timeline

- The older adult and authorized family caregivers may add events occurring between visits.
- Entries may include symptoms, sleep, medication-taking behavior, adherence, and other relevant factual events.
- Every entry retains the reporter or observer, whether it is a patient report or another person's observation, the reported event time, entry time, uncertainty, and sharing status.
- The timeline may support a factual before-visit agenda or history for professional review.
- It must not diagnose, recommend treatment, or infer unsupported causality.

## Minimum P0 Handoff

The handoff captures the following on a best-effort basis and never fills gaps through speculation:

1. Visit identity: approximate date, care location or provider type, and reason for the visit.
2. Patient-reported account: what the older adult understood the clinician to have communicated.
3. Medication facts: identifiable medication, stated purpose, timing, duration, and relevant cautions when available.
4. Evidence and provenance: medication-bag image, written instruction, patient recollection, authoritative reference, or family observation.
5. Unresolved items: anything missing, conflicting, uncertain, or not heard or understood clearly.
6. Follow-up status: the patient or caregiver's reported attempt to clarify an unresolved item with a pharmacist, clinic, or emergency service.

An incomplete record may still be useful and shareable, but it must not conceal missing information or present recollection as verified clinical instruction.

## Professional Follow-up Provenance

The prototype trusts a good-faith self-attested report that a patient or authorized caregiver contacted a professional.

The record preserves:

- who made the contact;
- which professional or organization they contacted;
- when contact occurred;
- the factual clarification they report receiving; and
- who entered the clarification.

The interface must distinguish "reported by a family member after a call" from direct professional verification. The prototype does not require call recordings, supporting documents, or professional accounts and must not label the result "verified by the clinic."

## Consent and Sharing

- Consent is recipient-specific and persists until the older adult explicitly revokes it.
- The older adult can review what will be shared, choose recipients, approve or decline access, see who currently has access, and revoke future in-product access.
- Caregiver assistance with the interface does not transfer sharing authority.
- Revocation prevents continued in-product access but cannot retract information already copied, exported, or acted upon; this limitation must be visible.
- The delivery surface must not silently grant historical access when group membership changes.

## Delivery Surface: Explicitly Unresolved

The product interaction hypothesis is a shared conversation among the older adult, authorized caregiver, and MedBuddy. The delivery implementation is not yet selected.

Candidates for later evaluation are:

1. MedBuddy participating in an existing LINE group.
2. A lightweight dedicated shared conversation with more direct control over consent and provenance.

The selection must consider:

- onboarding and sign-in friction for older adults;
- platform penetration among the target segment;
- group membership and historical-data access;
- privacy and health-data duplication;
- provenance in interleaved conversation;
- bot and structured-interaction constraints;
- consent persistence and revocation limitations; and
- fallback behavior when integration is unavailable.

LINE is a leading delivery candidate and a hypothesis to test, not a requirement on which the product thesis depends.

## Failure and Escalation Behavior

When medication identity or instructions cannot be confidently established, MedBuddy must:

- state exactly what remains unidentified or irreconcilable;
- request better factual input when available;
- keep conflicting accounts separately attributed;
- allow the handoff to continue with a prominent unresolved status;
- direct the patient or caregiver to an appropriate pharmacist or clinic;
- record later clarification without rewriting the original account; and
- interrupt the normal flow with human or emergency escalation guidance when potentially urgent symptoms or immediate medication risk are present.

MedBuddy must not guess, diagnose, prescribe, recommend starting or stopping medication, or make an autonomous medical decision.

## Validation and Invalidation

Test the workflow with two or three closely matched families. Observe whether:

- the older adult willingly reviews and shares the handoff;
- the adult child distinguishes facts, reported accounts, and unresolved questions without explanation;
- the record reveals a meaningful information gap or prevents conflicting family reconstruction;
- the family completes appropriate professional follow-up when clarification is needed;
- the older adult feels supported rather than monitored; and
- both participants voluntarily use the workflow after a second event.

One family's rejection triggers investigation. The same foundational rejection across at least two closely matched families triggers review of the relevant thesis:

- Adult children do not consider post-visit reconstruction important or cannot create value without taking control.
- Older adults experience sharing as surveillance, loss of authority, or excessive work despite appropriate consent.
- Families understand the workflow but prefer existing calls, photos, and messages because structured handoff adds no meaningful clarity.
- Participants avoid discussing health information with an AI participant or cannot understand provenance in a shared conversation.

The following findings warrant iteration but do not independently invalidate the thesis:

- Hearing difficulty is not the cause of the capture-and-sharing failure, provided the broader failure remains real and painful.
- The initial professional-facing presentation is ineffective, provided the system still captures useful, attributable facts.

## Explicit Non-goals

The initial product will not:

- diagnose a condition;
- prescribe or recommend changing a medication or dose;
- decide whether the older adult should start or stop treatment;
- infer unsupported causality between treatments, foods, behaviors, and symptoms;
- speculate to complete missing facts;
- present AI output as original clinical instruction;
- require active clinician or pharmacist participation;
- perform comprehensive interaction checking;
- guarantee speech transcription;
- solve every disability, cultural, memory, or communication problem; or
- lock the product to LINE or any other delivery channel before evaluation.

## Confirmed Stage 2 Adversarial Review

### Autonomy and first-market boundary

**Decision**

- Patient consent is mandatory before any persistent patient-specific record exists.
- The adult child remains the primary coordinating user but never gains unilateral authority.
- The first-market segment requires a recurring and consequential post-visit reconstruction failure. It does not require hearing difficulty or any other single cause.

**Rejected alternatives**

- A caregiver privately creating a persistent patient record without patient consent.
- Targeting all older adults with a possible communication barrier.

**Evidence**

- Confirmed product decision grounded in autonomy, anti-surveillance principles, founder evidence, and the challenge's older-adult-friendly requirement.
- The recurrence and severity of the qualifying failure remain hypotheses requiring target-family validation.

**Invalidation**

- Matched families experience the qualifying event but do not find it painful or consequential enough to change behavior.
- Adult children cannot create value without taking control from the older adult.

### Attributed account, not recovered truth

**Decision**

- MedBuddy constructs an attributed post-visit account from available evidence. It never claims to recover a lost clinical conversation.
- Only an original artifact or contemporaneous capture may be labeled as original clinical instruction.
- Patient recollection, written instructions, medication-label facts, general reference information, caregiver observations, and reported follow-up remain separately labeled.
- Conflicting claims remain separately attributed and require human clarification.

**Rejected alternatives**

- Presenting patient recollection or derived medication data as the clinician's original instruction.
- Selecting the most likely instruction when sources conflict.

**Evidence**

- Binding challenge grounding and medical-safety obligations.
- Confirmed product decision supporting trust and provenance.

**Invalidation**

- None for the provenance boundary. Better evidence may reduce uncertainty but cannot justify silent source rewriting or autonomous conflict resolution.

### Medication grounding and decision refusal

**Decision**

- General drug references may describe general uses and cautions but never establish the patient's diagnosis, prescribing rationale, timing, or duration.
- Patient-specific purpose and usage require an attributed report, written instruction, or reported professional follow-up.
- Medication identity remains unresolved when label or package evidence is insufficient.
- A medication-decision question receives a deterministic refusal, grounded risk handling, appropriate human escalation, and factual logging.
- MedBuddy never advises starting, stopping, continuing, or changing medication.

**Rejected alternatives**

- Inferring patient-specific treatment rationale from medication identity.
- Reassuring a user because no known reference warning was found.
- Answering whether the person should change or stop medication.

**Evidence**

- Binding challenge safety contract and confirmed product decision.

**Invalidation**

- None. These boundaries remain even if future models or data sources become more capable.

### Shared conversation and canonical handoff

**Decision**

- Conversation is the capture and collaboration surface.
- A structured, provenance-linked handoff is the canonical review artifact; the raw chat transcript is not the source of truth.
- A participant explicitly invokes MedBuddy to create or update a handoff.
- Candidate facts are reviewed together during handoff creation rather than confirmed after every message.
- Confirmation authority follows provenance: contributors correct their own reports, and conflicting accounts remain separate.
- The health-information owner approves sharing with new recipients.
- P0 uses one canonical handoff with a concise conversation view and a denser review/export view. It does not create separate family and clinician products.

**Rejected alternatives**

- Treating the chat transcript as the family record.
- Interrupting every health-related message with a confirmation task.
- Allowing one participant to rewrite another participant's account.
- Building a clinician dashboard, account, inbox, or separate summary system.

**Evidence**

- Confirmed product decision mapped to the current fragmented LINE, photo, and call workflow.
- Professional presentation remains unvalidated.

**Invalidation**

- Target families prefer the raw conversation and find the structured handoff unnecessary or more confusing.
- Batch review is too burdensome or review status is routinely misunderstood.
- Professionals cannot use the factual record even after presentation changes.

### Deterministic MedBuddy participation

**Decision**

- In a fully consented and approved group, MedBuddy passively processes health-related messages.
- `👀` is the only automated reaction and means "captured for review," never verified, safe, or clinically important.
- Non-health messages receive no reaction.
- Textual replies require an explicit `@MedBuddy` mention.
- A deterministic high-risk trigger is the only exception and may produce an unsolicited safety-escalation message.
- Confidence-based autonomous participation is deferred.

**Rejected alternatives**

- Letting the model decide when to enter the conversation in the first version.
- Using multiple semantic, approval-like, or reassuring emoji reactions.

**Evidence**

- Confirmed interaction decision grounded in auditability, predictability, autonomy, and safety.

**Invalidation**

- Participants interpret `👀` as endorsement, cannot predict when MedBuddy will speak, or find passive processing intrusive despite informed consent.

### Owner, participant, and group consent

**Decision**

- Each MedBuddy group has exactly one health-information owner.
- The owner self-establishes with one of these deterministic commands:
  - `@MedBuddy 我同意記錄我的健康資訊`
  - `@MedBuddy I consent to MedBuddy recording my health information`
- Every participant must consent before MedBuddy processes their messages.
- Before consent, MedBuddy processes only a recognized consent command; earlier messages are not processed retrospectively.
- The owner approves sharing with the displayed current-member snapshot using:
  - `@MedBuddy 我同意群組分享`
  - `@MedBuddy I consent to group sharing`
- A membership change invalidates group approval and creates a hard block.
- While blocked, MedBuddy performs no health-message processing, `👀` reactions, handoffs, patient-specific answers, or health-related escalation.
- MedBuddy posts one immediate block notice, keeps the block visible, and repeats the notice on MedBuddy interactions or unresolved consent attempts.
- The block ends only after the owner approves all current members or unapproved members leave.
- Changing the health-information owner requires a new or reset workspace.
- Proxy and legal-representative consent are out of scope.

**Rejected alternatives**

- Patient consent alone covering other participants' message processing.
- A participant's processing consent granting access to the owner's health information.
- Continuing partial processing while membership approval is incomplete.
- Requiring a public declaration such as "I am the patient."

**Evidence**

- Confirmed product decision grounded in privacy, autonomy, deterministic behavior, and the limitations of third-party group chat.

**Invalidation**

- The delivery platform cannot reliably identify senders, detect membership changes, or enforce the block.
- Participants cannot connect the short consent commands to the displayed members and consequences.
- Target users cannot distinguish MedBuddy access control from third-party chat-history retention.

### Delivery and modality scope

**Decision**

- The P0 prototype demonstrates a patient-caregiver-MedBuddy shared conversation without building a general-purpose chat product.
- It may reuse an existing messaging surface, embeddable chat primitive, or minimal conversational shell, whichever yields the fastest realistic test.
- Real LINE integration is P2 after the core workflow is complete.
- Recording and transcription are optional P2 stretch capabilities only after the complete non-audio workflow works.
- The product thesis depends on shared coordination, not LINE or voice.

**Rejected alternatives**

- Building a full chat application to avoid LINE integration.
- Spending P0 on real LINE integration before validating the workflow.
- Making recording or transcription prerequisites for comprehension and handoff.

**Evidence**

- Confirmed scope decision consistent with the 48-hour constraint and the challenge's accessible-chat option.

**Invalidation**

- The non-audio workflow is unusable for the qualifying segment rather than merely less convenient.
- The chosen prototype shortcut prevents realistic consent, provenance, or multi-participant testing.

### Longitudinal boundary

**Decision**

- P0 demonstrates one post-visit handoff, one later attributed symptom, adherence report, or caregiver observation, and a history-preserving handoff update.
- P1 adds a multi-event timeline, filtering, and factual before-visit agenda.
- P2 or later may explore trend interpretation, cross-visit analytics, or automated pattern detection without asserting unsupported causality.

**Rejected alternative**

- Building a full longitudinal chronic-care product inside the 48-hour prototype.

**Evidence**

- Confirmed scope decision satisfying the challenge's structured-logging requirement while protecting the handoff wedge.

**Invalidation**

- A single later event is insufficient for target families to understand why longitudinal continuity matters.

### Challenge depth and differentiation

**Decision**

- The primary challenge depth area is **Caregiver workflows**.
- The specific depth thesis is consented caregiver collaboration with a provenance-preserving handoff.
- Medication grounding, structured logging, accessible chat, reviewable summaries, and safety escalation remain supporting required capabilities.
- MedBuddy complements authoritative healthcare records; it does not compete as a medication-record database.
- MedBuddy captures outside-care understanding, behavior, symptoms, observations, uncertainty, and follow-up while keeping authoritative records distinct.

**Rejected alternatives**

- Attempting equal depth across voice, grounding, multilingual speech, caregiver workflow, clinician workflow, safety, and longitudinal analytics.
- Reproducing My Health Bank or presenting family and AI accounts as more authoritative than clinical records.

**Evidence**

- Confirmed product decision aligned with the challenge's caregiver-workflow depth option.
- The existence of authoritative Taiwan health records is an authoritative market fact; the value of the complementary family layer is a hypothesis requiring validation.

**Invalidation**

- Families obtain sufficient comprehension and coordination from authoritative records plus existing communication.
- Families do not value collaborative handoff even when consent and provenance are understandable.

### Validation and rejection criteria

**Decision**

- Voluntary reuse after a second event remains the primary value signal.
- A successful family result also requires correct understanding of `👀`, provenance, unresolved status, consent scope, revocation limits, professional escalation, and the older adult's authority.
- Failure on a critical safety-comprehension check blocks a successful validation result even if the family reuses the product.
- Rejection of passive listening is an interaction-model rejection when the family still values the structured handoff. It triggers testing of explicit forwarding, form-assisted capture, or `@MedBuddy`-only processing.
- Rejection of both passive capture and the structured handoff because existing calls, photos, and messages are sufficient challenges the core thesis.
- One matched family's rejection triggers investigation. The same rejection in at least two matched families triggers review of the relevant interaction model or thesis.

**Rejected alternative**

- Treating stated satisfaction, task completion, or reuse alone as sufficient validation.

**Evidence**

- Confirmed evaluation decision. Actual target-family feedback remains pending.

**Invalidation**

- Core thesis: matched families do not gain meaningful clarity from the structured handoff.
- Interaction model: matched families value the handoff but reject passive AI participation.
- Consent model: participants cannot understand or safely operate the group-level access controls.

## PRD Readiness

Stage 1 product intent and Stage 2 adversarial review are confirmed. The next gate must restate the complete intended PRD scope, success criteria, constraints, safety boundaries, and non-goals for explicit approval before `docs/PRD.md` is drafted.
