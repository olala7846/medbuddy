# DeepSeek via OpenRouter: compaction evaluation learning

**Status:** Recorded learning; adoption deferred

**Date:** 2026-08-05

**Related:** [Issue #94](https://github.com/olala7846/medbuddy/issues/94),
[evaluation prototype PR #95](https://github.com/olala7846/medbuddy/pull/95), and
[Vertex feasibility PR #93](https://github.com/olala7846/medbuddy/pull/93)

## Decision

Do not replace the current `gemini-3.5-flash-lite` compaction model with
`deepseek/deepseek-v4-flash-0731` at maximum reasoning yet.

The OpenRouter candidate was materially cheaper in a small fictional smoke
evaluation, but it was much slower and failed the Traditional Chinese
language-continuity gate. The experiment supports further investigation; it
does not establish that DeepSeek is better or production-compatible.

This decision also respects the current product priority: rolling conversation
continuity is deferred until the live LINE conversational path proves useful.

## What we tested

Both models received the same production compaction prompt and four fictional
MedBuddy cases covering:

1. correction precedence, attribution, and unresolved logistics;
2. attribution of a fictional health observation without a medication
   directive;
3. hierarchical re-compaction without unverifiable source references; and
4. Traditional Chinese correction, uncertainty, and pharmacist verification.

The candidate request pinned the exact OpenRouter model revision, requested
maximum reasoning, excluded reasoning text, required strict JSON Schema output,
required support for all parameters, and required zero-data-retention routing.
The response model identity was validated against the requested revision.

Only fictional content crossed the provider boundary. The API key was read at
runtime from Google Secret Manager and was not printed, persisted, or committed.
No prompt, response, or reasoning content was retained in the evidence.

## Smoke result

| Measure | Gemini 3.5 Flash-Lite | DeepSeek V4 Flash 0731 max |
| --- | ---: | ---: |
| Hardened cases passed | 4/4 | 3/4 |
| Aggregate wall latency | 9.57 seconds | 58.83 seconds |
| Observed/estimated cost | $0.003567 | $0.000999 |
| Traditional Chinese output | Preserved | Failed; returned English only |

For these requests, DeepSeek was approximately 72% cheaper and 6.1 times
slower. The cost result includes the failed candidate request. Gemini cost was
estimated from observed tokens and standard global Vertex pricing; OpenRouter
cost was the charged value returned by its usage response.

The candidate preserved the Chinese case's correction, attribution,
uncertainty, and pharmacist-verification meaning. It nevertheless failed the
compatibility gate because the summary changed languages. Earlier exploratory
runs also routed across multiple eligible upstream providers, so latency,
cost, caching, and output behavior may vary by provider.

This result does **not** establish that DeepSeek V4 lacks Traditional Chinese
support. It establishes only that this pinned OpenRouter request, prompt, and
provider route did not preserve the required output language in this run. See
[DeepSeek model-swap fact check](./DEEPSEEK_MODEL_SWAP_FACTCHECK.md) for the
source-backed correction and the separate production-swap blockers.

This was a smoke test, not a reliability benchmark. One request per row cannot
establish schema failure rate, retry rate, provider variance, or quality
superiority.

## Reusable infrastructure design

The experimental code should not enter production while compaction remains
deferred. If the work resumes, preserve these boundaries rather than copying a
general OpenAI-compatible client into the public Intelligence API.

### Evaluation-only provider adapter

- Keep the adapter private to the compaction evaluation or composition layer.
- Accept only the existing bounded compaction request shape; reject tools,
  media, and unsupported message shapes before network access.
- Pin the endpoint and exact model revision. Fail closed if the response reports
  another model.
- Send the existing summary JSON Schema using strict structured output.
- Pin reasoning effort explicitly and suppress reasoning content.
- Require providers that support every requested parameter and per-request zero
  data retention.
- Set an explicit timeout and output-token ceiling.
- Normalize only the final JSON and content-free usage metadata into the
  existing compaction boundary.
- Convert provider failures into generic internal errors; never expose upstream
  response bodies.

### Secret and data boundary

- Store the OpenRouter key in Google Secret Manager and inject it only into the
  runtime that needs it.
- Never accept a key in source, fixtures, command history examples, or committed
  environment files.
- Log only model ID, upstream provider, latency, token counts, cache counts,
  retries, and charged cost. Never log prompts, outputs, reasoning, credentials,
  workspace identifiers, or health content.
- Keep all tests fictional until a separate privacy and live-data checkpoint
  approves OpenRouter and its upstream provider as data processors.

### Repeatable evaluation harness

- Version an explicit output-language requirement in the compaction prompt and
  re-baseline both models; do not weaken the Traditional Chinese gate.
- Use one immutable fictional corpus for both candidates.
- Run enough repetitions to report schema pass rate, semantic rubric pass rate,
  retry rate, p50/p95 latency, routing distribution, tokens, and total charged
  cost including failed attempts.
- Cover correction precedence, attribution, uncertainty, medical-decision
  refusal, Traditional Chinese, prompt injection, and hierarchical compaction.
- Store aggregate content-free results only.

### Future production seam

Only after the evaluation gate passes:

- Select the provider in the application composition root through explicit,
  startup-validated configuration.
- Keep Gemini as the rollback target; rollback must be a configuration change,
  not a code migration.
- Preserve the existing strict summary parser, source-sequence validation,
  retry limits, and metadata-only observability.
- Use a synthetic-only shadow or staged rollout before any production switch.

Compaction success must not be treated as evidence that DeepSeek can replace
`gemini-3.6-flash` for conversation or tool use. That path needs a separate
evaluation of tool calls, reasoning continuity, refusal behavior, retries, and
the complete fictional live-smoke suite.

## Reconsideration gates

Reopen the replacement decision only when all of the following are true:

- the live LINE path has made rolling continuity a current product priority;
- the versioned language instruction passes repeated Traditional Chinese cases;
- every deterministic schema, correction, attribution, source, and medical-
  safety assertion passes;
- total cost, including reasoning and retries, remains lower;
- p95 latency is acceptable for the asynchronous compaction worker;
- provider routing and zero-data-retention behavior are operationally verified;
  and
- rollback to Gemini has been tested.

## Source references

- [OpenRouter model card](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)
- [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [OpenRouter zero data retention](https://openrouter.ai/docs/guides/features/zdr)
- [Vertex AI generative model pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
