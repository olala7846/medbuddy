# OpenRouter DeepSeek V4 Flash compaction evaluation

**Status:** Phase A evidence only; no production model change

**Date:** 2026-08-05

**Tracking:** [GitHub issue #94](https://github.com/olala7846/medbuddy/issues/94)

## Question

Can `deepseek/deepseek-v4-flash-0731` at maximum reasoning preserve the
MedBuddy compaction contract while costing materially less than the current
Vertex AI `gemini-3.5-flash-lite` model?

This evaluation uses only synthetic records. It does not authorize OpenRouter
to process real family or health data, and it does not change production
composition.

## Configuration and safety boundary

- The candidate model ID is pinned to `deepseek/deepseek-v4-flash-0731`.
- Reasoning effort is pinned to `max`; reasoning text is excluded.
- Strict JSON Schema output is required.
- OpenRouter routing must support every requested parameter and zero data
  retention.
- Requests have a 60-second timeout and a 16,384-token output ceiling.
- The API key is supplied at runtime and is never logged or stored in results.
- Recorded metrics contain case identifiers, routing, tokens, latency, and cost,
  but no prompt or response content.

The OpenRouter settings follow its documentation for [structured
outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
and [zero data retention](https://openrouter.ai/docs/guides/features/zdr).

## Method

Both models received the same production compaction prompt and four fictional
MedBuddy cases. Deterministic assertions checked:

1. correction precedence, attribution, and unresolved logistics;
2. attribution of a fictional health observation without invented medical
   advice;
3. hierarchical re-compaction without unverifiable source references; and
4. a Traditional Chinese correction, uncertainty, and pharmacist-verification
   need without a medication directive.

Each row below is one live request. Gemini cost is estimated from the observed
token counts and Vertex AI standard global pricing of $0.30/M input tokens and
$2.50/M output tokens. OpenRouter cost is the amount returned by its usage API.
Token counts are model-specific and should not be compared as if they used the
same tokenizer.

## Result

| Case | Gemini result | Gemini latency | Gemini estimated cost | DeepSeek result | DeepSeek latency | DeepSeek charged cost |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| Correction and logistics | Pass | 2,436 ms | $0.000886 | Pass | 39,035 ms | $0.000531 |
| Health attribution and safety | Pass | 2,112 ms | $0.000679 | Pass | 4,058 ms | $0.000089 |
| Hierarchical re-compaction | Pass | 2,076 ms | $0.000614 | Pass | 4,115 ms | $0.000089 |
| Traditional Chinese correction | Pass | 2,422 ms | $0.000991 | Pass | 10,824 ms | $0.000256 |
| **Total** | **4/4** | **9,046 ms** | **$0.003170** | **4/4** | **58,032 ms** | **$0.000966** |

The candidate was approximately **69.5% cheaper** for this matrix and
approximately **6.4 times slower** in aggregate. OpenRouter routed the clean
comparison run to DeepInfra; exploratory runs also used other eligible
providers, so provider-dependent variance remains a deployment consideration.

## Decision

The narrow compatibility and cost claim is supported: DeepSeek V4 Flash 0731
at maximum reasoning passed the current fictional compaction gates at a
materially lower charged cost.

The stronger claim that it is better is **not yet established**. Four cases and
one clean comparison run are too small to establish quality superiority, and
the latency regression is substantial. Do not replace the production
compaction model yet.

The next useful verification is a repeated fictional corpus with p50/p95
latency, structured-output failure rate, routing distribution, and correction,
attribution, uncertainty, multilingual, and hierarchical-compaction scores.
Only after that gate should the project consider a shadow or staged compaction
rollout. Testing DeepSeek as a replacement for `gemini-3.6-flash` conversation
generation remains a separate Phase C because that path has tools and broader
behavioral requirements.

## Remaining effort estimate

- Harden and repeat the compaction evaluation: **6–10 engineering hours**.
- Add production-ready provider composition, observability, fallback, and a
  synthetic-only shadow/staged rollout: **8–16 engineering hours** after the
  evaluation gate passes.
- Evaluate the broader `gemini-3.6-flash` conversation path separately:
  **8–16 engineering hours** for an initial compatibility matrix.

These ranges exclude any legal/privacy review required before sending real
user data through OpenRouter.
