# MedBuddy PRD Decision Log

**Status:** Stage 1 product intent confirmed

**Confirmed:** 2026-07-27

**Purpose:** Preserve confirmed PRD interview decisions before adversarial review and PRD drafting

**Inputs:** Prototype challenge, candidate preparation guide, prior product-intent discovery, and the Stage 1 founder interview

> This is a decision log, not the PRD. Stage 2 may refine these decisions through adversarial review. No external target-family feedback has occurred yet.

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

## Stage 2 Questions

Stage 2 must challenge, rather than assume:

- whether an adult-child primary user is compatible with an older-adult-controlled product;
- whether the broader instruction capture-and-sharing wedge is specific enough to support a focused first-market segment;
- whether structured handoff improves on existing LINE, photo, and call workflows;
- whether persistent family access creates surveillance or autonomy risks;
- whether recording or transcription is necessary;
- whether a shared AI conversation is trusted and understandable;
- which features address observed pain versus engineering interest; and
- what would cause matched families to reject or abandon the product.
