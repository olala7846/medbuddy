# Synthetic continuity fixture

`continuity-verification.jsonl` contains the English scenario and
`continuity-verification-zh-TW.jsonl` contains the equivalent fictional
Traditional Chinese scenario. Each file has one strict action envelope per line:

- `SEND` embeds the exact provider-shaped LINE event serialized and signed by the harness.
- `REPLAY_CONCURRENT` references one earlier `SEND` step and submits that exact signed body twice.
- `DRAIN` runs the deterministic local continuity queue until idle.

`{{RUN_NONCE}}` is the only supported placeholder. The loader replaces it in
fictional group, message, event, and reply-token values so target verification
uses an isolated cleanup scope. All content is fictional and nonmedical.

## Dynamic-memory acceptance gate

Run `npm run verify:memory:acceptance` for the Effort 3.7 synthetic gate. The
top-level tracer in `../memory-acceptance.test.ts` sends signed provider-shaped
LINE events through the real webhook, continuity, formation, passive-worker,
memory, and reply boundaries with fixed providers and no network access. It
uses two fictional groups and one fictional DM, reaches the production count
threshold, forms all three allowed record types silently, and proves a later
group member receives attributed workspace-shared evidence while both other
conversations remain empty.

The gate also selects the existing focused contract owners instead of copying
their assertions into the tracer:

- dynamic-memory contracts own eligibility exclusions, idempotency, query
  normalization/bounds/provenance/partial results, and lifecycle history;
- formation and passive-worker contracts own both policy profiles, all four
  first-threshold triggers, poison/recovery/stale/retry behavior, and silent
  autonomous operation;
- LINE, conversation, injection, medical-refusal, and family-map contracts own
  authentication, fail-closed scope, capability containment, and regressions;
- in-memory and Firestore files run the same repository contracts. Firestore
  cases activate when `FIRESTORE_EMULATOR_HOST` points to a fresh emulator.
