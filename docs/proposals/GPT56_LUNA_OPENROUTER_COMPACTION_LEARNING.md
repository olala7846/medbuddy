# GPT-5.6 Luna via OpenRouter: compaction evaluation learning

**Status:** Promising fictional evaluation; production adoption blocked

**Date:** 2026-08-06

**Related:**
[DeepSeek/OpenRouter learning](./DEEPSEEK_OPENROUTER_COMPACTION_LEARNING.md)
and [Issue #94](https://github.com/olala7846/medbuddy/issues/94)

## Decision

Do not replace the current `gemini-3.5-flash-lite` compaction model yet.

`openai/gpt-5.6-luna-20260709` at medium reasoning is the strongest OpenRouter
compaction candidate tested so far: it passed all repeated fictional cases,
preserved Traditional Chinese, and cost materially less than the successful
Gemini control. High reasoning did not improve the bounded rubric and cost more.

The production decision remains blocked because OpenRouter returned no Luna
endpoint compatible with per-request Zero Data Retention (ZDR). The quality and
cost measurements below therefore used an explicit fictional-only non-ZDR
override. They do not authorize real family or health data.

Rolling conversation continuity also remains deferred by the current product
direction until the live LINE path proves useful.

## Scope and method

The dated Luna revision received the same production compaction prompt and four
fictional MedBuddy cases used in the earlier evaluation:

1. correction precedence, attribution, and unresolved logistics;
2. attribution of a fictional health observation without a medication
   directive;
3. hierarchical re-compaction without unverifiable source references; and
4. Traditional Chinese correction, uncertainty, and pharmacist verification.

The evaluation used strict structured output, a fixed output ceiling, bounded
timeouts, parameter-support routing, response validation, and metadata-only
reporting. No prompt, response, or reasoning content was retained. The API key
was read at runtime from Google Secret Manager and was not printed, persisted,
or committed.

Medium reasoning ran three complete repetitions. High reasoning ran one
complete repetition. This remains a small smoke evaluation, not a reliability
benchmark.

## Results

| Configuration | Case executions passed | Average cost per four-case matrix | Aggregate latency per matrix | ZDR |
| --- | ---: | ---: | ---: | --- |
| Gemini 3.5 Flash-Lite recorded successful control | 4/4 | $0.003567 estimated | 9.57 seconds | Vertex boundary |
| GPT-5.6 Luna medium | 12/12 across three runs | $0.000895 charged | 12.23–15.03 seconds; 13.92-second mean | Unavailable |
| GPT-5.6 Luna high | 4/4 | $0.000988 charged | 13.65 seconds | Unavailable |

The content-free per-run measurements were:

- medium: $0.0008972 / 15.028 seconds, $0.0009032 / 12.227 seconds, and
  $0.0008852 / 14.496 seconds; and
- high: $0.0009884 / 13.647 seconds.

Against the recorded successful Gemini control, Luna medium was approximately
**74.9% cheaper** and **1.45 times slower** on mean aggregate latency. High was
approximately **10.4% more expensive than medium** with no observed rubric
benefit. The small latency difference between medium and high is not meaningful
from one high run.

Two fresh Gemini observations of the Traditional Chinese case failed the
language-continuity gate by switching entirely to English; the earlier recorded
Gemini control had passed. Luna medium preserved Traditional Chinese in all
three repetitions, and high preserved it in its one run. This suggests Luna may
be more reliable for the current Chinese fixture, but the sample is too small
to establish superiority.

OpenRouter's machine-readable price and promotional display changed during the
evaluation. Comparisons therefore use the charged `usage.cost` returned for
each Luna request rather than a marketing-page estimate. Gemini cost uses the
recorded token counts and Vertex global standard pricing.

## Compatibility learning

### ZDR routing is the hard blocker

With `provider.zdr: true`, OpenRouter returned no eligible Luna endpoint. The
model was callable only after the fictional evaluation explicitly omitted the
ZDR requirement. Production composition must continue to fail closed; it must
never silently retry through a non-ZDR provider.

### OpenAI strict schemas require a compatibility layer

The existing Zod-generated MedBuddy schema contains genuinely optional fields,
including attribution and source references. OpenAI strict structured output
requires every object property in `required`; optional values must instead be
represented as nullable.

A future Luna adapter must:

1. transform optional schema properties into required nullable properties;
2. preserve all existing bounds and `additionalProperties: false` rules;
3. remove only returned `null` values before the unchanged MedBuddy parser; and
4. continue validating the normalized object with the existing summary schema
   and source-sequence checks.

Forcing placeholder attribution or source values would be unsafe because it
could create false provenance. Disabling strict output would weaken the
contract. Nullable transport plus existing validation is the safe seam.

### Requested and returned model identifiers differ

The request used the dated canonical slug
`openai/gpt-5.6-luna-20260709`. OpenRouter returned the normalized model ID
`openai/gpt-5.6-luna`. Future metadata should retain both values. The request
must remain dated and pinned; response validation should accept only the
documented normalized ID for that pinned request.

### Medium is the appropriate next setting

Compaction is a bounded extraction and summarization task. Medium passed every
observed gate with fewer reasoning/output tokens and lower cost than high. A
larger evaluation should test medium first and use high only if a predefined
quality gate demonstrates a material benefit.

## Reusable evaluation and production boundary

If Luna is revisited:

- keep the adapter private to the compaction evaluation or composition layer;
- require an explicit fictional-only flag before allowing non-ZDR requests;
- reject non-ZDR configuration at production startup;
- pin the canonical model revision and record both requested and returned IDs;
- apply the documented strict-schema compatibility transformation;
- retain only model, provider, reasoning level, ZDR status, latency, token,
  retry, cache, and charged-cost metadata;
- repeat one immutable fictional corpus enough times to report pass rate,
  retries, p50/p95 latency, cost distribution, and language stability;
- keep Gemini as a configuration-only rollback; and
- use a synthetic shadow or staged rollout before any production switch.

Compaction results do not establish compatibility with the separate
`gemini-3.6-flash` conversation/tool-use path.

## Reconsideration gates

Reopen the replacement decision only when:

- rolling continuity becomes a current LINE product priority;
- OpenRouter exposes a Luna endpoint that passes enforced per-request ZDR;
- a repeated fictional corpus passes every schema, correction, attribution,
  source, Traditional Chinese, prompt-injection, and medical-safety gate;
- charged total cost, including retries and failures, remains below Gemini;
- p95 latency is acceptable for the asynchronous worker; and
- rollback to Gemini has been tested.

## Source references

- [OpenRouter GPT-5.6 Luna model card](https://openrouter.ai/openai/gpt-5.6-luna-20260709)
- [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter zero data retention](https://openrouter.ai/docs/guides/features/zdr)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Vertex AI generative model pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
