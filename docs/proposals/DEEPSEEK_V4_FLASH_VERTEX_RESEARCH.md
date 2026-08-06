# DeepSeek V4 Flash Vertex feasibility note

**Checked:** 2026-08-05

**Scope:** Fast, MedBuddy-specific feasibility check for replacing the compaction model and, only afterward, evaluating the conversation model. This note uses vendor and Google Cloud sources only.

## Executive finding

The exact DeepSeek offering exists, but it is **not currently a managed model on Vertex AI**:

- API model name: `deepseek-v4-flash`
- current model version behind that name: `DeepSeek-V4-Flash-0731`
- `max`: a thinking-effort choice, not part of the model ID

DeepSeek's own API price is materially below the standard Vertex list price of both `gemini-3.5-flash-lite` and `gemini-3.6-flash`. That does **not** establish that DeepSeek V4 Flash would be cheaper *on Vertex*: Google publishes no Vertex MaaS endpoint, token price, validated deployment recipe, or supported custom-weights import for V4 Flash. Self-hosting would be compute-billed and its cost cannot be inferred from DeepSeek's hosted-API token price.

There is also no official task-level evidence that V4 Flash is better at MedBuddy's compaction contract. DeepSeek's published benchmarks are general reasoning, coding, knowledge, and agent benchmarks rather than attributed medical-conversation compaction. The quality claim therefore remains an empirical hypothesis and must be tested with MedBuddy's fictional compaction evaluation.

## MedBuddy verification performed

The existing fictional-only compaction evaluation was run unchanged against the configured Vertex baseline on 2026-08-05:

```text
MEDBUDDY_VERTEX_PROJECT=med-buddy-503802 \
MEDBUDDY_VERTEX_LOCATION=global \
npm run eval:compaction

Test Files  1 passed (1)
Tests       3 passed (3)
Duration    6.72s (tests 6.49s)
```

The three cases verified correction and attribution preservation, unresolved fictional health-report handling without added medical advice, and higher-level re-compaction without unverifiable source references. This establishes a passing Gemini 3.5 Flash-Lite control, but the current harness does not emit per-case latency or token usage.

No V4 call was made. The configured project has Vertex AI enabled and no existing custom Vertex model or endpoint in `us-central1`, but Google publishes no V4 MaaS model ID to enable. No DeepSeek or OpenRouter API credential was present. As a result, this spike did not produce a MedBuddy quality, latency, or observed-cost comparison for V4 Flash.

## Model-name resolution

| User shorthand | Official resolution | Evidence |
| --- | --- | --- |
| “DeepSeek V4 Flash 0731” | API model `deepseek-v4-flash`; current served version `DeepSeek-V4-Flash-0731` | [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/) |
| “(max)” | Enable thinking and request `reasoning_effort: "max"`; DeepSeek documents `max` as a reasoning-effort mapping | [DeepSeek thinking-mode controls](https://api-docs.deepseek.com/guides/thinking_mode/) |
| “DeepSeek B4 Flash” | No official model with this name was found; interpret it as a typo for V4 Flash | [DeepSeek V4 release](https://api-docs.deepseek.com/news/news260424/) |
| “Gemini 3.5 Flash Lite” | `gemini-3.5-flash-lite`, GA since 2026-07-21 | [Gemini 3.5 Flash-Lite model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite) |
| “Gemini 3.6 Flash” | `gemini-3.6-flash`, GA since 2026-07-21; Google classifies it as a shorter-availability model with no retirement date yet announced | [Gemini 3.6 Flash model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-6-flash), [model lifecycle](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions) |

## Vertex availability and enablement

### DeepSeek V4 Flash

Google's current managed DeepSeek MaaS documentation lists `deepseek-v3.2-maas`, not V4 Flash. That endpoint is GA at `global`, processes in the `us` multi-region, supports a 163,840-token context and 65,536-token maximum output, and is already deprecated as of 2026-07-21 with retirement on 2026-10-21. It is therefore not a suitable surrogate for a V4-0731 claim. See the [DeepSeek V3.2 Vertex model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/deepseek/deepseek-v32).

Google's Preview “custom weights” import supports DeepSeek R1, V3, and V3.1, but does **not** list V4. It also says quantized imports are unsupported. Consequently the Model Garden one-click/custom-weights path is not an officially supported way to make V4 Flash available. See [Deploy models with custom weights](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-garden/deploy-models-with-custom-weights).

DeepSeek has published MIT-licensed V4 Flash weights (284B total parameters, 13B active, mixed FP4/FP8) and custom encoding/inference material. In principle these could be served through a bespoke Vertex custom container, but neither Google nor DeepSeek documents a validated Vertex V4 deployment topology, accelerator count, regional matrix, throughput, or cost. Google's generic custom-vLLM route requires building and pushing a container, registering the model, creating/deploying a Prediction Endpoint, and using a **Raw Inference Request** because vLLM's OpenAI endpoint does not satisfy Vertex's normal request/response envelope. This route is infrastructure work, not the quick MaaS enablement implied by the hypothesis. See the official [DeepSeek V4 Flash model card and weights](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash) and Google's [custom vLLM deployment guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/open-models/deploy-custom-vllm).

### What the managed Vertex flow would be if/when V4 MaaS appears

For managed open-model MaaS, Google requires:

1. Enable `aiplatform.googleapis.com`.
2. Open the Model Garden card whose name includes **API Service** and enable that model's API.
3. Call the published MaaS model ID and supported location with the Google Gen AI SDK.

These are the documented general MaaS steps, but there is no V4 Flash API Service card/model ID to enable today. See [Use open models with MaaS](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/open-models/use-maas).

## Protocol and contract compatibility

DeepSeek's hosted API supports OpenAI Chat Completions and Anthropic formats, plus JSON output and tool calls. Its V4 Flash context is 1M tokens and the documented maximum output is 384K tokens. Thinking is enabled by default at `high`; `max` is requested separately. Thinking mode ignores temperature, top-p, presence-penalty, and frequency-penalty settings. See [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/) and [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/).

This is functional overlap, not drop-in compatibility with MedBuddy's current Gemini/Vertex request shape. DeepSeek's hosted endpoint is not Vertex's Gemini `generateContent` endpoint, and its thinking response exposes `reasoning_content`. A direct-API experiment therefore needs a provider adapter and an explicit decision about retaining or discarding reasoning content. For compaction, JSON-mode support is promising, but only MedBuddy's existing strict schema parser and semantic evaluation can establish compatibility.

For reference, both Gemini targets support structured output, function calling, system instructions, Chat Completions, a 1,048,576-token context window, and 65,536 maximum output tokens. Gemini 3.5 Flash-Lite supports `global`, `us`, and `eu`; the current Gemini 3.6 model card does not publish entries under its “Supported regions” field. See the two Google model cards linked above.

## Published price comparison

USD per 1M tokens, standard online use, before any workload-specific token-volume effect:

| Service/model | Input | Cached input | Output | Important boundary |
| --- | ---: | ---: | ---: | --- |
| DeepSeek-hosted `deepseek-v4-flash` | $0.14 cache miss | $0.0028 | $0.28 | Direct DeepSeek API, not Vertex; DeepSeek says a future peak window will be 2x, with effective date still to be announced |
| Vertex `gemini-3.5-flash-lite` global | $0.30 | $0.03 | $2.50 | Standard PayGo, inputs at or below 200K |
| Vertex `gemini-3.6-flash` | $1.50 | $0.15 | $7.50 | Standard PayGo, inputs at or below 200K |
| Vertex `deepseek-v3.2-maas` | $0.56 | $0.056 | $1.68 | Different/deprecated model; not evidence about V4 |

Sources: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/), [Google Cloud generative-model pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing).

At list price, V4 Flash's direct hosted API is 53% cheaper on uncached input and 89% cheaper on output than Gemini 3.5 Flash-Lite; versus Gemini 3.6 Flash it is 91% cheaper on input and 96% cheaper on output. Those ratios are arithmetic on two vendors' published prices, not an end-to-end cost result. `max` reasoning can generate additional billed output tokens, so the actual comparison must use observed input, reasoning, final-output, retry, and contract-failure counts for the same cases.

## What official evidence does and does not support

Supported:

- DeepSeek V4 Flash is a real open-weight and hosted-API model, with a 1M context, JSON output, tool calls, OpenAI/Anthropic protocols, and a documented max reasoning mode.
- Its direct hosted-API unit prices are lower than the cited Gemini standard Vertex prices.
- Both Gemini names in the request are real, current GA models.

Not supported:

- V4 Flash being available as a managed Vertex MaaS model.
- DeepSeek's direct API price applying to a self-hosted Vertex deployment.
- A published V4 Flash versus Gemini 3.5 Flash-Lite or Gemini 3.6 Flash benchmark for conversation compaction.
- “Better” on MedBuddy's required preservation of attribution, corrections, unresolved loops, safety caveats, Traditional Chinese content, and hierarchical compaction.

## Recommended quick verification boundary

1. **Do not provision a large self-hosted Vertex endpoint for this first check.** There is no supported V4 path or defensible Vertex cost estimate yet.
2. If use of DeepSeek's external hosted API satisfies the project's data-governance requirements, run the existing fictional-only compaction evaluation through a minimal OpenAI-compatible adapter using `deepseek-v4-flash` in both non-thinking and max-thinking modes. Record per-case schema pass, semantic pass, latency, token usage including reasoning, and computed cost. Never send real family or medical data.
3. Compare against `gemini-3.5-flash-lite` on exactly the same immutable fictional cases. Replace compaction only if every deterministic contract and semantic gate passes and the observed total cost/latency is favorable.
4. Only then evaluate `gemini-3.6-flash` replacement on the conversation/tool-use suite. Compaction success cannot establish tool-loop, refusal, or conversational compatibility.
5. If “must stay on Vertex” is a hard requirement, pause V4 evaluation until Google publishes a V4 MaaS card/model ID, or explicitly fund a separate custom-serving feasibility study with accelerator sizing and idle-capacity cost included.

## Current blockers

- No official Vertex MaaS model ID or Model Garden API Service card for DeepSeek V4 Flash.
- V4 is absent from Google's supported custom-weights import list; the published weights are mixed FP4/FP8 while that Preview path rejects quantized imports.
- No official Vertex serving topology, region/accelerator validation, throughput, or token-equivalent price for V4 Flash.
- Direct DeepSeek API use introduces a new external processor, credentials, endpoint, data-governance review, and adapter surface.
- No official benchmark tests the MedBuddy compaction contract; evaluation must supply the evidence.
