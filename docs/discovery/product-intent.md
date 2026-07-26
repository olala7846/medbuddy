# MedBuddy Taiwan Product Intent

**Status:** Confirmed

**Confirmed:** 2026-07-25

**Purpose:** Discovery foundation for the PRD, not the PRD itself

**Inputs:** Founder interview, the MedBuddy prototype challenge, the AI Fund candidate preparation guide, and Taiwan/WHO source research

**Traditional Chinese reference:** [product-intent.zh-TW.md](product-intent.zh-TW.md)

> Privacy note: the motivating family experience is intentionally anonymized because this repository may be made public. The event sequence and product insights are preserved without names or a family member's specific diagnosis.

## Confirmed Intent

- **Outcome:** Turn one-time spoken clinical instructions into information that can be confirmed, reviewed, traced to its source, and shared with family when the older adult consents.
- **Primary user:** A 35-50-year-old adult child living in a Taiwanese metropolitan area, apart from their parents, who informally coordinates the parents' health information.
- **Older-adult participant:** A mostly independent parent who lives with a spouse in another well-served Taiwanese city, manages a chronic condition across hospitals and clinics, and has experienced difficulty hearing and recounting clinical instructions.
- **Why now:** Taiwan offers convenient access to hospitals and clinics, but the resulting instructions, prescriptions, and family observations remain fragmented. LINE messages, medication-bag photos, and memory-based retelling do not establish a reliable shared account of what happened.
- **Product wedge:** Hearing-related failure of medical communication. Hearing difficulty qualifies the initial segment; multimodal accessibility is a design principle, not a claim to solve every accessibility need.
- **Success:** The older adult voluntarily and repeatedly shares visit information; the family can understand and assist without taking over; the older adult experiences support, achievement, and closer family connection rather than surveillance.
- **Trust and safety:** Clearly distinguish original clinical instructions, authoritative government or professional references, family observations, and AI-generated content. Escalate uncertainty instead of inventing an answer.
- **Longer-term direction:** Grow from visit-to-family handoff into a longitudinal family health collaboration layer that gives older adults, families, pharmacists, and clinicians a shared, traceable history.

## First-Market Cell

| Dimension | Confirmed choice |
| --- | --- |
| Market | Taiwan |
| Primary user | Digitally capable adult child, approximately 35-50 |
| Parent location | A different Taiwanese city with relatively strong medical access |
| Household | Two parents living together and remaining mostly independent |
| Care pattern | Long-term hospital follow-up plus episodic visits to local clinics |
| Communication condition | The parent has previously been unable to confirm or recount spoken clinical instructions because of difficulty hearing |
| Family coordination | Adult children coordinate remotely; the spouse provides local observation |
| Existing channel | LINE, calls, and photos of medication bags or medicines |
| Decision authority | The older adult retains the final health and medication decision |
| Trusted sources | The treating physician or pharmacist, followed by identifiable government sources such as MOHW, NHIA, and TFDA |

The primary user, phone operator, medication manager, health decision-maker, and beneficiary are not assumed to be the same person:

- The adult child is the primary coordinating user.
- The older adult is the principal beneficiary, an active participant, and the final decision-maker.
- The spouse is an on-site observer and helper, not automatically the medication manager.
- Physicians and pharmacists remain the sources for clinical judgment.

## Representative Medication-Communication Episode

1. An older adult independently visits a local clinic for a new symptom.
2. The family cannot verify whether the clinician was told about the adult's chronic conditions and current medicines.
3. The adult returns with medication but cannot clearly recount the clinician's assessment, instructions, intended duration, or relationship to existing treatment.
4. If the medicine does not appear effective, the adult may stop taking it without professional confirmation.
5. Remote family members ask questions through LINE, request photos, and compare partial accounts from different relatives.
6. The spoken clinical context is already gone, so the family never establishes a trustworthy shared account of what occurred.

This is not primarily a reminder failure. It is a failure to preserve, verify, and hand off medical communication.

## Current Workaround and Why It Fails

- **LINE questions and calls:** Depend on the older adult hearing, remembering, and retelling accurately.
- **Medication-bag photos:** Show dispensed products but do not preserve the clinician's reasoning, cautions, or follow-up instructions.
- **Family reconstruction:** Different relatives hold different fragments with no shared provenance.
- **Independent searching:** May provide general drug information but cannot recreate patient-specific instructions.
- **NHI records:** Existing records are important context, but records alone do not capture everything the person heard, understood, took, stopped, or used outside covered prescriptions.

The family lacks a shared source of truth, not a willingness to help.

## Medication Reality

The motivating case includes long-term hospital treatment, episodic clinic prescriptions, and a past period of traditional Chinese medicine use. There is no current evidence of an over-the-counter supplement problem.

The product may record what was reportedly used, when it started or stopped, and contemporaneous symptoms. It must not infer that a medicine, traditional remedy, food, or supplement caused an improvement or deterioration without appropriate evidence and professional judgment.

## Trust, Consent, and Family Relationship

- The older adult's cooperation is necessary; family access must not be treated as automatic.
- Sharing should strengthen the adult's autonomy and sense of accomplishment rather than frame them as a monitored data source.
- Family members may observe, organize, ask questions, and encourage professional follow-up. They may not silently replace the adult's decisions.
- Advice is more likely to be accepted when it can be traced to the treating clinician, pharmacist, or an authoritative public source.
- Unknown, conflicting, or risky information must remain visibly uncertain and be referred to a qualified human.

## Product Promise and Non-Goals

### Initial promise

After a visit, the older adult and remote family can confirm:

- what the clinician communicated;
- how the medication was meant to be used; and
- what remains uncertain or requires professional follow-up.

### Explicit non-goals

The initial product will not:

- diagnose a condition;
- prescribe or recommend changing a medication or dose;
- decide whether the older adult should start or stop treatment;
- infer unproven causality between treatments, foods, and symptoms;
- present AI output as if it were original clinical instruction;
- treat hearing loss;
- attempt to solve every older-adult accessibility need;
- make generic reminders, comprehensive interaction checking, or full chronic-care management its central product promise.

The challenge still requires grounded medication explanations, structured logs, reviewable summaries, and safety escalation. Those capabilities should support the communication-and-handoff wedge rather than become unrelated product centers.

## Why Hearing-First, Not Voice-First

The founder's initial concern is not that older adults lack a voice interface. It is that spoken medical information is ephemeral and may never be reliably heard, confirmed, or retold.

Rejected framings:

- **"Medication tool for people with hearing disabilities":** Too medicalized and likely to exclude people with real communication difficulty who have no formal diagnosis or do not identify as disabled.
- **"Accessibility for all older adults":** Too broad; vision, hearing, cognition, dexterity, language, and literacy produce different problems and require different accommodations.
- **"Voice AI for older adults":** Treats audio as the answer even when hearing difficulty is part of the problem, and assumes speech recognition can reliably handle accents, mixed languages, and atypical speech.

Selected framing:

> Make spoken clinical instructions reviewable, confirmable, and shareable for families already experiencing hearing-related communication failure.

Voice, recording, transcription, text, images, or human correction may later support this outcome, but no modality is predetermined by this intent brief. The eventual design must tolerate recognition failure and preserve source provenance.

## Evidence Ledger

### Founder evidence

- A family member receives long-term hospital care while also visiting local clinics independently.
- Hearing difficulty makes it hard for the family to know whether clinical instructions were heard or relevant history was communicated.
- Remote relatives use LINE and photos to reconstruct events but remain unable to verify instructions or actual medication behavior.
- The older adult retains final decision authority and responds better to information traceable to clinicians, pharmacists, or authoritative government sources.
- Continued, voluntary sharing is a stronger success signal than one-time technical completion.

These observations support the product thesis but do not establish market prevalence.

### Market facts

- Taiwan's 2026 resident-population statistics report that 19.2% of residents are at least 65 years old and 71.7% of residents live in the six municipalities. This supports a narrow city-level first-market cell rather than a generic "Taiwanese older adult." [Taiwan National Statistics](https://www.stat.gov.tw/News_Content.aspx?n=3703&s=235805)
- People insured by Taiwan NHI may choose among contracted hospitals, clinics, and pharmacies. Convenient multi-provider access makes cross-provider communication a relevant workflow to investigate. [NHIA](https://www.nhi.gov.tw/en/cp-1065-d7cde-125-2.html)
- My Health Bank already provides cross-institution health and medication records. The product thesis therefore concerns comprehension, actual behavior, and handoff rather than assuming no records exist. [NHIA My Health Bank](https://www.nhi.gov.tw/en/cp-562-2313c-22-2.html)
- Taiwan's medication-safety programs identify older adults using more than five medicines and living with multiple chronic conditions as a high-concern group. [MOHW](https://www.mohw.gov.tw/cp-3219-22662-1.html)
- Taiwan's ICOPE-based program treats hearing as one of six distinct older-adult capacities. Among approximately 192,000 assessed older adults reported through August 2023, 8.7% screened abnormal for hearing; this service result is not a national prevalence estimate. [MOHW](https://www.mohw.gov.tw/cp-6560-75997-1.html)
- A community hearing study in two Taipei districts found substantial age-related hearing loss, but its local, volunteer sample should not be generalized into a national prevalence estimate. [Original Taiwan study](https://pmc.ncbi.nlm.nih.gov/articles/PMC11743292/)
- WHO reports that unaddressed hearing loss can limit communication and contribute to social isolation, loneliness, and stigma; available support includes captioning and assistive technologies as well as hearing devices. [WHO](https://www.who.int/news-room/fact-sheets/detail/deafness-and-hearing-loss)
- Taiwan's web accessibility guidance treats electronic text as presentation-neutral information that can be rendered visually, audibly, tactilely, or in combination. This supports multimodal design rather than audio-only delivery. [Ministry of Digital Affairs](https://accessibility.moda.gov.tw/Accessible/Guide/68)

### Unvalidated product hypotheses

- Similar Taiwanese adult children see themselves as informal health coordinators.
- Hearing-related loss of clinical instructions is painful enough to motivate continued use.
- Older adults will voluntarily share information when the experience reinforces autonomy and family connection.
- The adult-child-first model produces more value than an older-adult-only workflow.
- Families will trust a clear separation between source material, family observations, and AI assistance.
- The workflow can fit naturally alongside LINE without requiring LINE itself to be the product.

## Interview Decision Trail

| Topic | Decision |
| --- | --- |
| Initial user | Changed from older adult as presumed primary operator to the remote adult child as primary coordinating user |
| Older-adult role | Active participant, beneficiary, consent holder, and final decision-maker |
| Geography | Medical-resource-rich Taiwanese cities, where fragmentation matters more than provider scarcity |
| Accessibility | Hearing-related communication failure is the segment wedge; accessibility remains a design principle |
| Core problem | Loss of spoken clinical context, not merely missing reminders or medication records |
| Existing workflow | LINE, calls, medication photos, and fragmented family reconstruction |
| Trust | Treating professionals and identifiable public-health sources outrank unsourced family or AI interpretation |
| Core promise | Preserve and hand off what was communicated, how medicine should be used, and what still needs confirmation |
| Success | Accurate shared understanding plus voluntary, repeated older-adult participation |
| Safety | No diagnosis, prescribing, autonomous medication decisions, or unsupported causal claims |
| 12-week view | Repeated use across 5-10 closely matched families without creating a surveillance dynamic |
| Six-month view | Longitudinal family health collaboration and professional-reviewable history |

## Validation Plan and Gaps

- One motivating family is available for an initial prototype session.
- One older relative may be useful as an accessibility edge case but is not yet considered representative of the first-market cell.
- Recruit one or two additional families that closely match the confirmed segment:
  - parents remain mostly independent;
  - parent and adult child live apart;
  - at least one parent has experienced hearing-related failure to confirm or recount clinical instructions;
  - the adult child already participates in health-information coordination.
- Observe both the adult child and older adult. Interviewing only the adult child cannot validate willingness, dignity, or continued sharing.
- Record what each participant understands, ignores, refuses, or corrects, and what changes in the prototype as a result.

The most important unresolved risk is whether the founder's family experience generalizes to other closely matched Taiwanese families.

## Intentionally Deferred to the PRD and TDD

This intent brief does not decide:

- whether the delivery channel is LINE, a standalone application, web, or another surface;
- whether information is captured by recording, live transcription, manual entry, document/photo import, or another method;
- which spoken languages the first prototype supports;
- data-sharing permissions, consent flows, retention, or revocation mechanics;
- specific NHI, My Health Bank, clinic, pharmacy, or hospital integrations;
- the medication reference source and grounding architecture;
- AI model selection, speech-recognition thresholds, correction workflows, or failure handling;
- detailed caregiver and clinician interfaces.

Those decisions must trace back to this confirmed intent, the challenge safety contract, and evidence from the next user sessions.
