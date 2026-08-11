# DeepSeek model-swap fact check

**Status:** Corrected decision record; fictional evaluation only

**Checked:** 2026-08-10

## Conclusion

Traditional Chinese is **not** a categorical blocker to DeepSeek. DeepSeek
publishes Chinese-language benchmark results, and DeepSeek V4 Flash publishes a
Chinese-SimpleQA result. This supports the limited claim that the model can
work in Chinese.

It does **not** prove reliable Traditional Chinese output for MedBuddy. The
vendor does not make a separate Traditional-Chinese quality guarantee. The
existing fictional compaction smoke also returned English for one
Traditional-Chinese request. That was a valid output-language compatibility
failure for that exact model, provider route, prompt, and run. It was not
evidence that DeepSeek cannot support Traditional Chinese in general.

Do not replace MedBuddy's live `gemini-3.6-flash` Vertex conversation model
with DeepSeek V4 now. The main blockers are provider, privacy, integration,
and product-validation risks. They are stronger than the language finding.

## What the official sources establish

| Question | Finding | Limit |
| --- | --- | --- |
| Does DeepSeek V4 exist and support API features relevant to this product? | Yes. DeepSeek lists `deepseek-v4-flash` and `deepseek-v4-pro`. V4 Flash has a 1M-token context and supports JSON output and tool calls. | This is feature availability, not MedBuddy compatibility. |
| Does DeepSeek support Chinese? | Yes, to a meaningful extent. DeepSeek's V4 Flash card reports Chinese-SimpleQA results. DeepSeek's V3 technical material also reports several Chinese benchmarks. | Neither source separately measures Traditional Chinese, script preservation, medical names, or safe caregiver-facing wording. |
| Can V4 be selected in the current Vertex integration? | No managed Vertex V4 model is documented. Google documents `deepseek-v3.2-maas`, not V4. | V3.2 is a different model and its MaaS endpoint is deprecated, with retirement scheduled for 2026-10-21. |
| Is direct DeepSeek API use suitable for real family health data? | Not without a separate privacy and legal approval. DeepSeek says its services are not intended for sensitive data, including health data; it describes use of inputs to improve its technology (with an opt-out) and processing in the People's Republic of China. | This applies to DeepSeek's direct service. It does not decide the contractual/data path for a distinct managed provider. |

## What the earlier experiment actually decided

The recorded decision evaluated only **compaction**, not a full live-model
replacement. It sent four fictional cases through OpenRouter to the pinned
`deepseek/deepseek-v4-flash-0731` route. The candidate passed three cases and
returned English for the Traditional Chinese case. It was also about 6.1 times
slower in that one-run-per-case smoke. The decision therefore deferred a
compaction replacement.

The live LINE reply path has a higher bar. It uses Vertex REST with
`gemini-3.6-flash`, has a bounded function-call loop, a strict tool boundary,
retry and timeout behavior, metadata-only observability, and deterministic
medical-safety refusal before model discretion. The current configuration
explicitly allowlists the two Gemini model IDs. DeepSeek V4 is not a model-name
change in this architecture.

## Actual blockers to a production swap

1. **Hosting and protocol.** There is no documented managed Vertex V4 endpoint.
   A direct DeepSeek or OpenRouter route needs a provider adapter, new
   authentication and secret handling, a response/tool-call normalizer, and
   rollback behavior. Self-hosting is a separate infrastructure project.
2. **Privacy and data processing.** Direct DeepSeek use needs explicit
   approval before any real family or health content crosses that boundary.
   Until then, use only fictional or properly approved de-identified
   evaluation data. A Vertex third-party-model route also needs a written
   contract and data-flow review. Google's zero-data-retention position does
   not remove the third party's applicable terms.
3. **Safety and contract evidence.** General Chinese benchmarks and JSON/tool
   support do not prove the required MedBuddy behavior. The candidate must pass
   repeated tests for Traditional-Chinese output, script preservation,
   correction and attribution, bounded tool calls, schema validity, refusals,
   uncertainty, retries, and timeout behavior.
4. **Observed performance.** The prior small smoke showed a lower charged cost
   but much higher latency. A replacement decision needs repeated p50/p95
   latency, failure/retry rate, routing stability, and total cost results.
5. **Priority.** Current product direction prioritizes the working LINE
   text-to-model-to-LINE loop. It defers rolling continuity work. A full model
   migration would not advance that first proof until it has evidence that it
   preserves the same safety and operational boundaries.

## Recommended next decision

Keep Gemini on Vertex for the live path. Reopen DeepSeek only as a
fictional-data evaluation, in two stages:

1. Test the direct candidate behind a narrow provider seam. Require an
   explicit `zh-Hant` output instruction and repeated locale-specific cases.
   Record content-free pass/fail, latency, token, cost, and provider-route
   metadata.
2. If it passes compaction, run a separate conversation and tool-use evaluation.
   Do not send real data or change the live provider until privacy approval,
   provider contract review, rollback testing, and all safety gates pass.

The language gate should stay. Its meaning should be precise: **the tested
configuration did not reliably preserve the required output language**. It
must not be restated as **DeepSeek does not support Traditional Chinese**.

## Next fictional evaluation: signed LINE JSONL scenario

Use the existing
[`continuity-verification-zh-TW.jsonl`](../../apps/web/tests/fixtures/continuity-verification-zh-TW.jsonl)
scenario. It contains only fictional, provider-shaped LINE events. The harness
signs the events, replays one event concurrently, drains deterministic
continuity work, and keeps the fixture data isolated by a run nonce.

Do not alter the fixture or add real health details for this evaluation. Reuse
the existing counterfactual aliases. They prevent outside knowledge of the
fictional family names from satisfying the relationship checks.

Run the evaluation in this order:

1. Add a DeepSeek V4 evaluation-only provider adapter. It must reject media,
   unbounded calls, unsupported tool responses, and non-fictional input.
2. Send the JSONL scenario with an explicit `zh-Hant` response requirement.
   Run enough independent repetitions to report a pass rate and p95 latency.
3. Require both replies to remain in Traditional Chinese. Require the existing
   correction, attribution, relationship, no-family-map-write, retry, timeout,
   and medical-safety assertions to pass.
4. Retain only content-free results: requested and returned model IDs,
   endpoint or provider route, latency, token count, retry count, status, and
   cost. Do not retain prompts, responses, or reasoning.
5. Keep this evaluation opt-in and fictional-only. Do not change the live
   Vertex provider or use real family data unless a separate privacy review,
   provider approval, safety evaluation, and rollback test pass.

The existing Vertex-specific evaluation is not a DeepSeek test. The new
adapter and an equivalent opt-in command are required before this round can
run. Passing compaction alone also does not authorize a live conversation-model
swap.

## Sources

- [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/) — V4 model names, context, JSON output, tool calls, and pricing.
- [DeepSeek V4 Flash model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash) — DeepSeek-published Chinese-SimpleQA results and model modes.
- [DeepSeek V3 repository](https://github.com/deepseek-ai/DeepSeek-V3) — DeepSeek-published Chinese and multilingual benchmark results; supporting evidence only, not a V4 Traditional-Chinese guarantee.
- [Google Cloud: DeepSeek V3.2 MaaS](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/deepseek/deepseek-v32) — the documented Vertex DeepSeek model, capabilities, and deprecation/retirement.
- [DeepSeek privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) — direct-service sensitive-data and processing statements.
- [Google Cloud Vertex AI data governance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention) and [service-specific terms](https://cloud.google.com/terms/service-terms/index-20240229) — Google-side training/retention statement and the continuing third-party-model terms boundary.
- [Earlier MedBuddy DeepSeek/OpenRouter evaluation](./DEEPSEEK_OPENROUTER_COMPACTION_LEARNING.md) — fictional smoke scope and observed results.
- [MedBuddy product direction](../../PRODUCT_DIRECTION.md) — live LINE priority and binding safety/privacy constraints.
