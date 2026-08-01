# Proposal: Agent Memory Architecture

**Status:** Proposed for review

**Date:** 2026-07-31

**Related product direction:** [`../../PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md)

**Related alpha specification:** [`../TELEGRAM_FAMILY_ALPHA_SPEC.md`](../TELEGRAM_FAMILY_ALPHA_SPEC.md)

## 1. Summary

MedBuddy should add a shared agent-memory capability for the conversational agent and other intelligence workflows. The capability should make the bot feel continuous and personalized while preserving a strict boundary between AI-generated memory and the reviewed care record.

The recommended first implementation is intentionally small:

1. Keep Firestore as the only application database.
2. Add persisted thread state, rolling summaries, and a small structured memory collection.
3. Add one channel-neutral context assembler used by every intelligence endpoint.
4. Retrieve reviewed care facts deterministically and keep them authoritative.
5. Use LangChain's current Google integration for model, structured-output, tool, and context-management support.
6. Defer LangGraph-managed persistence, Agent Platform Memory Bank, and vector retrieval until the basic workflow is useful and measurable.

This follows the memory model described by LangChain—thread-scoped short-term state plus cross-thread semantic, episodic, and procedural memory—without replacing MedBuddy's safety and provenance model with framework defaults.

## 2. Why This Matters Now

The Telegram family alpha must do more than receive messages and extract isolated facts. In ordinary family conversation, the agent needs to understand what the family is currently coordinating, recall relevant reviewed observations, remember stable preferences, and avoid repeatedly asking for known context.

The current implementation has useful persistence primitives but no agent-memory system:

- Chat passes the latest 20 messages to Intelligence.
- Conversation context contains messages only.
- The responder does not retrieve facts, summaries, preferences, or prior outcomes.
- Capture proposes atomic facts, but no process summarizes or consolidates conversational experience.
- Firestore has repositories for messages, facts, reviews, and handoffs, but no thread-state or memory repository.

The existing reviewed care record is a strong foundation. It must not be collapsed into generic agent memory: reviewed health facts have different authority, retention, provenance, and correction rules from preferences or conversation summaries.

## 3. Terminology

| Term | Meaning in MedBuddy |
| --- | --- |
| Source event | A persisted message, attachment, command, tool result, or review action. It is evidence, not automatically memory. |
| Working memory | Thread-scoped state needed for the current conversation, such as recent messages, a rolling summary, and an active task. |
| Care record | Reviewed or explicitly status-labeled health facts, conflicts, and handoffs with source provenance. It is the authoritative health record inside MedBuddy. |
| Semantic memory | Stable shared context and preferences, such as relationships, terminology, and summary style. |
| Episodic memory | A compact account of a prior interaction, task, decision, or accepted outcome. |
| Procedural memory | Versioned instructions, safety policy, tools, prompts, and examples that govern agent behavior. |
| Memory candidate | A proposed durable memory that has not yet met promotion policy. |
| Promoted memory | A durable memory eligible for retrieval or automatic context injection. |

## 4. Design Principles

### 4.1 The care record remains authoritative

Agent memory may point to reviewed facts, summarize them for context, or help retrieve them. It may not convert an inference, transcript summary, or model-generated memory into a reviewed health fact.

When the two disagree, the reviewed care record and its correction history win. A response must expose the source and uncertainty of material health claims.

### 4.2 A transcript is evidence, not durable memory

Most messages should remain ordinary history until deleted by retention policy. Only information that is useful across future turns and permitted by policy should be promoted into durable memory.

### 4.3 Retrieval is a policy decision

Similarity alone must not decide what enters the prompt. Retrieval must first enforce workspace, participant, care-subject, visibility, consent, review-status, and expiry boundaries. Relevance, recency, importance, and diversity are ranking inputs only after authorization and trust filters pass.

### 4.4 Memory must be inspectable and forgettable

Every durable memory needs source references, creation method, visibility, status, expiry, and supersession history. Deletion must cover derived summaries and embeddings as well as source content where the retention and provenance model permits.

### 4.5 One context boundary serves all intelligence

Chat, pre-visit preparation, after-visit communication, and future intelligence endpoints should not implement independent retrieval logic. They should receive a bounded, validated `AgentContext` from one context-assembly module.

### 4.6 Start deterministic and measure before adding retrieval infrastructure

One family and one care subject do not require a vector database. Structured Firestore queries by subject, time window, memory type, and review status are simpler to validate. Semantic retrieval should be introduced only when a measured recall problem justifies it.

## 5. Current System Compared With the Target

| Capability | Current system | Target capability | Gap |
| --- | --- | --- | --- |
| Recent conversation | Last 20 raw workspace messages | Token-bounded recent turns plus rolling summary | No summary, token budget, or thread boundary |
| Agent state | Stateless request/response | Persisted thread checkpoint and active task state | No resume or tool-state continuity |
| Medical facts | Candidate/reviewed facts with provenance | Deterministically retrieved authoritative care context | Facts are not supplied to the responder |
| Personalization | None | Small shared profile and explicit preferences | No semantic memory |
| Past outcomes | Raw history only | Compact, relevant episodic summaries | No episodic memory or consolidation |
| Agent behavior | Hard-coded prompts and routes | Versioned, evaluated procedural assets | No explicit procedural-memory lifecycle |
| Retrieval | Recent-message slicing | Authorized, typed, budgeted retrieval | No planning, ranking, deduplication, or diversity |
| Memory writing | Fact capture only | Candidate, promotion, correction, supersession, expiry | No general memory lifecycle |
| Multi-user scope | Workspace and member identities | Workspace, subject, participant, visibility, authority | Shared versus participant-private memory is undefined |
| Observability | Domain and adapter tests | Retrieval and memory-quality evaluation with content-safe telemetry | No relevance, stale-memory, or false-memory evidence |

## 6. Proposed Memory Layers

### 6.1 Working memory

Working memory is scoped to a channel-neutral conversation thread. For the first Telegram group, the group maps to one thread unless Telegram topics are later enabled.

It contains:

- a rolling summary of older relevant turns;
- a bounded recent-message window;
- active intent, such as preparing for a visit;
- pending tool operations and their safe outputs;
- the last processed source revision; and
- summary version and generation metadata.

Working memory should use token thresholds rather than a fixed message count. Recent messages remain verbatim while older context is summarized. The summary is an aid to conversation, not a canonical source for medical claims.

### 6.2 Canonical care memory

The existing care record remains a separate domain module. The context assembler retrieves it through narrow read interfaces using:

- care subject;
- time window;
- fact type;
- review status;
- contributor or source when relevant; and
- handoff or visit context.

Material health statements should cite the underlying facts or source events, not an agent summary.

### 6.3 Semantic memory

Semantic memory contains stable context that improves future interactions, for example:

- family-preferred names or neutral aliases;
- participant relationships and roles;
- preferred summary length and format;
- recurring care locations or professionals when explicitly retained;
- vocabulary the family uses for recurring observations; and
- explicit instructions such as "remember that we prefer bullet summaries."

For the initial family alpha, semantic memory should be shared-with-group only. Participant-private memories introduce difficult visibility expectations in a shared chat and should be deferred until a clear use case and interface exist.

### 6.4 Episodic memory

Episodic memory captures useful prior outcomes rather than replaying entire transcripts. Examples include:

- a pre-visit brief was generated for a stated window and accepted;
- the family corrected an incorrectly inferred event date;
- a visit-summary format was revised after feedback; or
- an unresolved question remained open after a visit.

Episodes should remain source-linked, compact, and searchable. They should not restate health facts as if independently verified.

### 6.5 Procedural memory

Procedural memory includes:

- system prompts;
- deterministic safety routes;
- tool descriptions and authorization rules;
- memory capture and retrieval policies;
- few-shot examples; and
- evaluation fixtures.

These assets belong in version-controlled code or configuration. Live family conversation must not automatically rewrite them. Changes require review and evaluation.

## 7. Proposed Runtime Shape

```text
Telegram update or intelligence request
                    |
                    v
            deterministic safety route
                    |
                    v
              ContextAssembler
              |-- working thread state
              |-- recent source events
              |-- reviewed care facts
              |-- shared semantic memory
              |-- relevant episodes
              `-- procedural instructions
                    |
                    v
          bounded, validated AgentContext
                    |
          +---------+----------+
          |         |          |
          v         v          v
        chat   pre-visit   after-visit
          |         |          |
          +---------+----------+
                    |
                    v
          persisted outcome and trace metadata
                    |
                    v
         asynchronous memory consolidation
```

The `ContextAssembler` should be a deep module with a small interface. Intelligence receives assembled context and permitted tools, never Firestore clients. This preserves the existing dependency direction and makes context policy independently testable.

## 8. Memory Read Policy

The first retrieval policy should be explicit and ordered:

1. Load procedural instructions required for the endpoint.
2. Load the current thread summary and bounded recent turns.
3. Determine the relevant care subject, task, and time window.
4. Retrieve reviewed care facts deterministically.
5. Load a small set of active shared semantic memories.
6. Retrieve episodic memories only when the current intent benefits from them.
7. Deduplicate overlapping content and fit the result into an endpoint-specific token budget.
8. Preserve source identifiers so the response renderer can cite material claims.

Only promoted, active memories may be automatically injected. Raw history, unreviewed candidates, rejected memories, expired memories, and participant-invisible memories require explicit policy and must not leak into context.

If semantic search is later introduced, ranking should combine:

- semantic relevance;
- keyword relevance for exact names and terms;
- recency decay for ordinary episodes;
- explicit importance;
- diversity to avoid redundant results; and
- evergreen treatment for curated preferences that should not decay.

## 9. Memory Write and Consolidation Policy

### Hot path

During a request, MedBuddy should synchronously persist only what is required for correctness:

- the source event;
- the thread checkpoint;
- explicit "remember this" candidates;
- deterministic care-fact candidates through the existing capture path; and
- metadata-only outcome records.

This keeps agent response latency and failure modes bounded.

### Background path

A bounded background job may run after a message threshold, completed task, visit boundary, or explicit command. It may:

- update the rolling summary;
- propose semantic or episodic memory candidates;
- deduplicate similar memories;
- supersede stale preferences rather than overwrite history;
- associate source references;
- apply expiry; and
- promote only items permitted by policy.

Health facts continue through contributor review. Action-sensitive memories—permissions, clinician-reported instructions, treatment changes, or anything that could cause the agent to act—must never be promoted solely because a model considered them important.

## 10. Minimal Data Concepts

This proposal does not finalize storage schemas, but the next design should define at least:

### `ThreadState`

- workspace and thread identifiers;
- summary text and source revision range;
- active task type and safe structured state;
- recent-message boundary;
- prompt/token accounting metadata;
- version and timestamps; and
- retention expiry.

### `MemoryItem`

- workspace, care-subject, and visibility scope;
- semantic or episodic type;
- compact content and optional structured attributes;
- source event or care-record references;
- author or generation method;
- candidate, promoted, rejected, superseded, or expired status;
- confidence and importance as advisory metadata;
- observed-at, created-at, expires-at, and superseded-by fields;
- review or promotion authority; and
- optional embedding metadata added later.

### `AgentContext`

- endpoint and current intent;
- bounded recent turns and thread summary;
- reviewed care facts with citations;
- selected semantic and episodic memories with source metadata;
- allowed tools and procedural policy version;
- token budget and truncation record; and
- context-generation metadata for evaluation.

## 11. Framework and GCP Recommendation

### LangChain

Use the current `@langchain/google` JavaScript integration to access Gemini through Vertex AI. LangChain provides structured output, multimodal input, tool calling, and context middleware without requiring it to own MedBuddy's persistence model.

Adopt LangChain concepts and middleware incrementally. Do not expose LangChain message or checkpoint types as domain contracts; place them behind Intelligence adapters so the framework remains replaceable.

### LangGraph

LangGraph's checkpoint and store abstractions fit the desired short- and long-term model, but its documented production JavaScript persistence integrations currently emphasize PostgreSQL, MongoDB, and Redis rather than Firestore.

Do not add Cloud SQL merely to obtain an official LangGraph saver. Initial thread state can use MedBuddy's Firestore repositories. LangGraph can be adopted later if resumable multi-step workflows, human-in-the-loop interrupts, or time-travel debugging produce enough value to justify a custom Firestore adapter or an additional managed database.

### Firestore and Vertex AI embeddings

Firestore should remain the first memory store. It supports metadata-filtered document queries and native vector nearest-neighbor search if semantic retrieval becomes necessary. Vertex AI can generate embeddings without introducing another provider.

If vector search is enabled, the chosen Vertex embedding output dimension must be at most Firestore's supported 2,048 dimensions. Retrieval must prefilter by authorization and subject metadata before similarity ranking.

### Agent Platform Memory Bank

Google Agent Platform Memory Bank provides managed sessions, memory generation, scoping, revisions, and retrieval. It is a credible later implementation behind the MedBuddy memory interface.

It should not be the first alpha dependency because:

- the existing TypeScript modular monolith already persists the necessary source events;
- managed automatic memory generation would need careful validation for sensitive family context;
- it creates a second persistence and lifecycle model alongside the care record; and
- the first family does not yet justify the migration or platform coupling.

An evaluation spike can compare Memory Bank with the Firestore implementation after real usage produces synthetic, anonymized failure cases.

## 12. Incremental Delivery

### Phase 1: Context foundation

- Introduce `AgentContext` and one `ContextAssembler` boundary.
- Retrieve reviewed facts for mentioned questions and summary endpoints.
- Persist `ThreadState` with a rolling summary and bounded recent turns.
- Add token-budget and source-attribution tests.
- Continue using deterministic Firestore queries.

**Value:** The bot can answer with recent conversational continuity and relevant reviewed care history.

### Phase 2: Shared durable memory

- Add `MemoryItem` contracts and Firestore repository.
- Support explicit remembered preferences and group-visible inspection/deletion.
- Add background episodic consolidation with promotion policy.
- Add correction, supersession, expiry, and retention jobs.
- Add false-memory, stale-memory, scope-leakage, and deletion tests.

**Value:** The bot becomes personalized and improves across conversations without treating every message as permanent.

### Phase 3: Retrieval quality

- Collect metadata-only retrieval measurements and synthetic evaluation cases.
- Add lexical or vector retrieval only for demonstrated recall failures.
- If needed, use Vertex embeddings and Firestore vector search with metadata prefilters.
- Add hybrid ranking, recency, importance, and diversity.

**Value:** The agent can find older relevant episodes as history grows without loading the entire transcript.

### Phase 4: Orchestration evaluation

- Evaluate LangGraph for resumable multi-step workflows.
- Evaluate Agent Platform Sessions and Memory Bank behind existing interfaces.
- Adopt either only if it reduces operational or product complexity in measured workflows.

## 13. Evaluation and Observability

Memory changes should be driven by evaluation rather than subjective impressions alone. The minimum synthetic evaluation set should test:

- retrieval of a relevant reviewed fact;
- exclusion of rejected and expired facts or memories;
- correct handling of corrected and superseded information;
- no cross-workspace, cross-subject, or visibility leakage;
- relevant preference recall;
- refusal to turn a conversational inference into a medical fact;
- source citation for material health statements;
- graceful behavior when no relevant memory exists;
- deletion of source-derived summaries and embeddings; and
- prompt-injection content stored in messages or memories remaining untrusted.

Production telemetry should record identifiers, versions, counts, latency, token usage, retrieval scores, and status—not message bodies, health facts, prompts, model output, or embeddings. Live family content must not be copied into LangSmith or another external observability system without explicit privacy and contractual review. Synthetic traces may be used for framework evaluation.

## 14. Proposed Change to the Approved Alpha Scope

The current Telegram family-alpha specification lists vector search and long-term model memory as non-goals. If this proposal is accepted, amend that statement narrowly:

- **In scope:** persisted working memory, rolling summaries, reviewed-care-record retrieval, explicit shared preferences, source-linked episodic summaries, retention, inspection, and deletion.
- **Deferred:** vector search until a measured retrieval gap exists; autonomous procedural-memory updates; model training on family data; private per-participant memory; and a general-purpose memory platform.

This keeps the first goal unchanged: deliver the Telegram message-to-reviewed-fact-to-visit-brief vertical path. Memory work is justified only where it directly improves that live workflow.

## 15. Alternatives Considered

### Continue with the last 20 messages only

- Benefit: no new storage or lifecycle logic.
- Cost: loses older context, repeatedly asks for stable information, and cannot reliably ground summaries in reviewed facts.
- Not recommended because it cannot demonstrate a continuous family agent.

### Adopt LangGraph plus Cloud SQL immediately

- Benefit: documented production checkpoint and store integrations.
- Cost: adds a second database and migrations before the workflow requires complex graph persistence.
- Deferred because it conflicts with the prototype's simplicity constraint.

### Build a custom Firestore LangGraph checkpointer immediately

- Benefit: one database and full LangGraph semantics.
- Cost: substantial framework-adapter work before proving that resumable graphs are needed.
- Deferred in favor of small MedBuddy-owned state contracts.

### Use Agent Platform Memory Bank immediately

- Benefit: managed long-term memory generation, scoping, revisions, and retrieval.
- Cost: platform coupling and a second sensitive-data lifecycle whose behavior must be validated against MedBuddy's review model.
- Deferred as a later adapter evaluation.

### Add Firestore vector search immediately

- Benefit: semantic recall from the beginning.
- Cost: embeddings, indexes, deletion propagation, ranking evaluation, and additional failure modes for a tiny corpus.
- Deferred until deterministic retrieval fails a measured use case.

## 16. Decisions Requested From Review

1. Approve the separation between working memory, agent memory, and the canonical care record.
2. Approve Firestore and deterministic retrieval as the first implementation.
3. Approve one group-shared memory scope for the family alpha and defer participant-private memory.
4. Approve explicit or policy-reviewed promotion for durable memory rather than automatic promotion of all model extractions.
5. Approve LangChain integration without requiring LangGraph to own persistence initially.
6. Approve the narrow amendment to the alpha non-goals described above.

If approved, the next artifact should be a detailed design defining contracts, Firestore collections and indexes, retention transitions, context budgets, promotion rules, and acceptance tests. That design should precede implementation.

## 17. Primary References

- [LangChain: How to Give Your Agent Memory](https://www.langchain.com/blog/how-to-give-your-agent-memory)
- [LangChain JavaScript memory concepts](https://docs.langchain.com/oss/javascript/concepts/memory)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangChain built-in middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in)
- [LangChain context engineering](https://docs.langchain.com/oss/javascript/langchain/context-engineering)
- [LangChain Google integrations](https://docs.langchain.com/oss/javascript/integrations/providers/google)
- [OpenClaw memory](https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md)
- [OpenClaw memory search](https://docs.openclaw.ai/concepts/memory-search)
- [Firestore vector search](https://firebase.google.com/docs/firestore/vector-search)
- [Vertex AI text embeddings](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings)
- [Google Agent Platform Memory Bank](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank)
