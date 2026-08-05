# Synthetic continuity fixture

`continuity-verification.jsonl` contains one strict action envelope per line:

- `SEND` embeds the exact provider-shaped LINE event serialized and signed by the harness.
- `REPLAY_CONCURRENT` references one earlier `SEND` step and submits that exact signed body twice.
- `DRAIN` runs the deterministic local continuity queue until idle.

`{{RUN_NONCE}}` is the only supported placeholder. The loader replaces it in
fictional group, message, event, and reply-token values so target verification
uses an isolated cleanup scope. All content is fictional and nonmedical.
