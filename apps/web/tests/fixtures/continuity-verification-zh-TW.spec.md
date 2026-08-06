# Spec: Realistic Traditional Chinese Continuity Scenario

**Status:** Approved for implementation

**Data classification:** Entirely fictional evaluation data

**Locale:** Traditional Chinese (`zh-TW`)

## Objective

Replace the repetitive Traditional Chinese continuity fixture with a coherent,
multi-day LINE family-group conversation. The same sequence should remain useful
for compaction verification and become a stable foundation for later family-map,
grounded-fact, correction, chronology, attribution, and response evaluations.

The scenario monitors Grandpa 銀之介's health without granting MedBuddy medical
authority. Medication names remain generic. Clinical instructions appear only as
attributed reports of what a fictional clinician said.

## Cast and direct relationships

All six people are fictional observed LINE participants who can send their own
messages in this evaluation.

| Person | Role and explicit direct relationships |
| --- | --- |
| 銀之介 | Grandpa; 野原鶴's spouse; 廣志's father. |
| 野原鶴 | Grandma; 銀之介's spouse; 廣志's mother. |
| 廣志 | 銀之介 and 野原鶴's adult child; 美冴's spouse; 小新 and 小葵's father. |
| 美冴 | 廣志's spouse; 小新 and 小葵's mother; 銀之介 and 野原鶴's daughter-in-law. |
| 小新 | 廣志 and 美冴's child; 銀之介 and 野原鶴's grandchild. |
| 小葵 | 廣志 and 美冴's child; 銀之介 and 野原鶴's grandchild. |

Only direct relationships explicitly stated in the conversation are candidates
for future family-map persistence. The introductions intentionally state eight
unique direct edges rather than restating every pairwise relationship:

1. 銀之介—廣志 (parent and child)
2. 野原鶴—銀之介 (spouses)
3. 野原鶴—廣志 (parent and child)
4. 美冴—廣志 (spouses)
5. 美冴—小新 (parent and child)
6. 廣志—小新 (parent and child)
7. 美冴—小葵 (parent and child)
8. 廣志—小葵 (parent and child)

The shared phrase “小新和小葵是我們的孩子” explicitly supplies the four
parent-child edges involving 廣志 and 美冴. Relationships such as parents-in-law,
grandparents, and grandchildren are derived from this sparse graph. They may be
evaluated in a response but must not be written as extra family-map edges
automatically.

## Scenario chronology

The committed JSONL should use natural, non-repetitive messages across at least
nine fictional calendar days. Exact wording may change during implementation,
but the facts and ordering below are the independent source of truth.

### Day 1 — Group formation and identity

1. 廣志 creates the group to coordinate support for 銀之介.
2. The six people introduce themselves gradually, in their own messages.
3. Three introductions establish the eight direct edges above. Other people
   identify themselves without redundantly restating parents or grandparents.
   The graph must remain sufficient to derive the complete cast relationships
   without outside knowledge or surname inference.
4. 銀之介 agrees that the group may help record his appointments, medication
   confirmations, blood-pressure readings, dizziness, and sleep observations.

### Day 2 — Baseline observations before the first appointment

1. 銀之介 reports taking his prescribed morning medication after breakfast.
2. 野原鶴 records a fictional morning blood-pressure reading and pulse.
3. 銀之介 reports brief dizziness after standing, including approximate duration.
4. 美冴 records that 銀之介 slept poorly and woke several times overnight.
5. 廣志 confirms who will accompany 銀之介 to the first appointment.

### Day 3 — Appointment 1

1. 廣志 accompanies 銀之介 to a fictional general outpatient appointment.
2. 廣志 reports the appointment date and that he heard the clinician's guidance
   directly.
3. The fictional clinician reportedly recommended continuing the already
   prescribed morning and evening medications without changing them, measuring
   blood pressure after resting in the morning and evening, standing up slowly,
   and recording the timing and duration of dizziness.
4. 廣志 explicitly distinguishes clinician guidance from his own interpretation.
5. The group records the next follow-up date.

### Days 4–6 — Observations, adherence, and correction

1. At least two medication confirmations identify the day and morning/evening
   dose without naming a drug or changing a prescription.
2. At least three blood-pressure observations include who measured them and when.
3. At least one dizziness observation and one no-dizziness observation are
   attributed to 銀之介.
4. At least two sleep observations distinguish a poor night from a better night.
5. One caregiver corrects a mistyped blood-pressure value in a later message;
   the corrected value must supersede the earlier value without deleting either
   source event.
6. The first mentioned question asks MedBuddy for a bounded summary of the first
   appointment and subsequent observations. Its exact signed webhook request is
   replayed concurrently to verify idempotency.
7. Deterministic compaction drains after this point so Appointment 1 and its
   nearby facts move into derived history.

### Day 7 — Appointment 2

1. 美冴 accompanies 銀之介 to a second fictional follow-up appointment; 廣志 is
   not presented as an eyewitness.
2. 美冴 reports that the clinician reviewed the group's blood-pressure, dizziness,
   sleep, and medication-adherence notes.
3. The clinician reportedly recommended keeping the existing prescribed schedule,
   continuing morning/evening monitoring for another week, recording posture and
   duration if dizziness returns, and contacting the clinic if poor sleep persists.
4. The report includes a concrete next follow-up interval but no diagnosis,
   autonomous medication change, or invented clinical authority.

### Days 8–9 — Post-appointment facts and final grounded question

1. 銀之介 or a caregiver records another morning-medication confirmation.
2. The group records a later blood-pressure observation and whether dizziness
   occurred.
3. 銀之介 records the most recent sleep observation, which may differ from the
   previous night's report.
4. Deterministic context assertions keep Appointment 2, the latest medication
   confirmation, the most recent dizziness observation, and the most recent
   sleep observation in recent evidence.
5. The final mentioned question isolates the family-graph experiment by asking
   for three concise relationships, distinguishing directly stated edges from
   inferred parents-in-law and grandparent/grandchild relationships. It defines
   the evidence labels without revealing an answer: an introduction's explicit
   relationship is direct, while a relationship requiring two or more explicit
   edges is inferred. It requests a terse three-line semantic format so all
   required assertions fit within the live responder's output budget.

## Project structure and code style

- `continuity-verification-zh-TW.jsonl` remains the human-inspectable provider
  event sequence, with one strict JSON action per line.
- Harness and fixture-loader changes remain under `apps/web/tests/`.
- Source code, identifiers, test descriptions, and canonical documentation remain
  English. Traditional Chinese appears only in the explicitly requested fixture
  and literal evaluation expectations.
- Provider IDs remain fictional ASCII identifiers with `{{RUN_NONCE}}`; messages
  contain no real LINE IDs, people, clinics, dates, credentials, or health data.
- Natural messages must do threshold work. Repeated filler sentences are forbidden.

## Testing strategy and commands

The public seam remains exact serialized LINE JSON plus HMAC signature entering
`LineWebhookHandler`. Verification observes replies, persisted source events,
compaction jobs and segments, deterministic queue drain, and assembled context.

```bash
npm run verify:continuity:memory
FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 npm run verify:continuity:emulator
MEDBUDDY_VERTEX_ENABLED=true MEDBUDDY_VERTEX_PROJECT=your-project npm run eval:continuity-family
npm test
npm run check
npm run build
```

The deterministic paths do not use the real LINE service, webhook registration,
Cloud Tasks, target Firestore, or real Vertex. The opt-in Vertex evaluation uses
fictional content and in-memory persistence; it makes model calls but performs no
target Firestore writes and no family-map writes. To prevent outside character
knowledge from satisfying the eval, it creates a temporary counterfactual view of
the same provider-shaped fixture with six unrelated fictional aliases before
signing and sending the events. The committed fixture remains unchanged. Semantic
scoring unwraps nested or fenced `REPLY` envelopes, rejects nested `CALL` output,
and requires each requested relationship and its direct/inferred label on the
same response line.

## Boundaries

### Always

- Preserve every accepted message as immutable, attributed fictional evidence.
- Keep Appointment 1 compacted and Appointment 2 recent so the final question
  crosses both continuity layers.
- Keep exactly two bot-mentioned turns and replay the first mentioned request.
- Prove the corrected measurement wins semantically while both raw events remain.
- Keep all clinical recommendations attributed to the fictional clinician.
- Derive cleanup scope from every fixture event so additional messages cannot leak.

### Ask first

- Adding real medication names or doses.
- Changing production continuity thresholds or persistence schemas.
- Expanding this fixture into an automated family-map write evaluation.

### Never

- Use real family, patient, clinician, clinic, LINE, or health information.
- Have MedBuddy diagnose, prescribe, change medication, or present an inference as
  a reported fact.
- Import character biography or relationships not explicitly defined in this spec.
- Satisfy compaction thresholds by duplicating sentences or padding messages.

## Success criteria

1. The introductions contain all six participants and exactly the eight approved
   unique direct edges, without redundant parent, in-law, or grandparent claims.
2. The story spans at least nine days and contains two completed, distinguishable
   appointments with facts before, between, and after them.
3. Every health observation is attributed to a sender and fictional time; every
   clinician recommendation is attributed to the appointment reporter.
4. The signed webhook, concurrent replay, deterministic drain, completed job,
   ready segment, isolation, and cleanup assertions pass in memory and Firestore.
5. Independent literals prove Traditional Chinese content from Appointment 1 is
   present in persisted sources, compaction input, the segment, and final history.
6. Independent literals prove Appointment 2 and the latest medication, dizziness,
   and sleep facts remain in recent context exactly once where appropriate.
7. A correction pair remains in immutable source history while the final expected
   context/evaluation identifies the corrected value as current.
8. The English fixture continues to pass unchanged.
9. Full tests, checks, and production build pass with no generated-file changes.
10. The opt-in live Vertex evaluation measures whether the requested direct,
    in-law, and grandparent relationships appear while the family map remains
    empty. A failed run is experiment evidence, not a deterministic-suite failure.

## Approved implementation plan

1. Add fixture-contract tests for the six senders, explicit relationships,
   multi-day chronology, two appointments, correction pair, and absence of
   repeated filler.
2. Replace the JSONL with natural provider-shaped events while preserving the
   signed webhook, replay, drain, and final-question milestone actions.
3. Expand canonical nonce-scoped cleanup coverage for every new event and keep
   cleanup validation strict.
4. Tune only message ordering and natural detail until Appointment 1 is inside
   the compacted range and Appointment 2 plus latest facts remain recent.
5. Run memory, fresh Firestore emulator, full tests, checks, build, privacy
   review, independent PR review, and merge-commit workflow.

Both 小新 and 小葵 are approved as chat-capable observed participants who send
their own introduction and occasional observation messages.
