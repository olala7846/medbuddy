# Spec: MedBuddy LangChain `createAgent` Migration

**Status:** Approved for implementation

## Objective

Replace MedBuddy's custom model/tool/model orchestration with one bounded
LangChain `createAgent()` runtime. Preserve the current channel-neutral
`ConversationResponder` interface and all externally visible behavior.

The migration must deliver these benefits:

- Keep application invariants in one trusted system prompt.
- Send compacted history in one versioned first-user recap envelope.
- Preserve chronological human and agent roles in later messages.
- Represent model and tool transitions with the standard LangChain message
  sequence.
- Expose the complete agent run tree to explicitly approved LangSmith traces.
- Make bounded tools easier to add without moving authorization or persistence
  into the framework.
- Keep the model adapter replaceable behind the Intelligence module.

The product is not launched. The completed migration becomes the only LINE
conversation runtime. Do not keep a production traffic split or a legacy
responder selector.

## Architecture

```text
ConversationResponder
  -> deterministic medical-safety and focal-authority checks
  -> trusted instructions + versioned untrusted recap + attributed messages
  -> invocation-local createAgent runner
       -> invocation-bound application tools
       -> bounded model/tool middleware
       -> ChatGoogle in Vertex mode
       -> optional invocation-local LangSmith callback
  -> terminal response and tool-outcome validation
  -> existing Chat publication and LINE acceptance workflow
```

### Module decisions

- `@medbuddy/contracts` owns the optional typed pre-focal message contract.
- `@medbuddy/chat` assembles chronological pre-focal messages and binds every
  mutation or query capability to the trusted workspace, actor, and focal
  source message.
- `@medbuddy/intelligence` owns prompt rendering, the `createAgent()` runner,
  application-tool adapters, framework budgets, model construction, terminal
  validation, and selective agent tracing.
- `@medbuddy/web` composes one production responder. It does not select between
  responder versions.
- Firestore continuity and dynamic memory remain the canonical state. Configure
  no LangGraph checkpointer or Store.
- LangChain types do not cross the public `ConversationResponder` interface.

## Behavioral invariants

### Trusted and untrusted context

- The system prompt contains identity, operating rules, medical-safety limits,
  tool-use rules, and application-provided system instructions only.
- Family-map content, agent-action history, compacted history, recent messages,
  focal text, tool inputs, and tool results are untrusted data.
- The first user message is versioned JSON with `type: "medbuddy_context"`, a
  trust label, family-map content, compacted recap, omission metadata, and
  legacy flattened history only when typed history is unavailable.
- Later messages preserve chronological `user` and `assistant` roles.
- The focal message appears exactly once as the final user message.
- Request-size accounting covers the rendered system prompt, recap envelope,
  role-preserving messages, focal message, and current tool transcript.

### Safety and authority

- Deterministic diagnosis, prescribing, and medication-change refusals run
  before model access.
- Historical content never authorizes a mutation.
- Chat binds workspace, actor, and focal-message scope before Intelligence sees
  a tool capability. Model-provided input cannot replace trusted scope.
- Every application tool keeps its existing input/output schema, canonical JSON
  snapshot, size bound, timeout, result disposition, and conflict behavior.
- The model cannot access repositories, raw history search, reviewed care,
  credentials, channel identifiers, filesystem, network tools, subagents,
  LangGraph persistence, or generic code execution.

### Agent execution

- Each turn constructs one invocation-local agent with only the eligible tools.
- Model retries are zero. The application owns one absolute turn deadline.
- Middleware enforces bounded model calls, total tool calls, and per-tool calls.
- A malformed tool call, malformed tool result, exhausted hard budget, provider
  failure, deadline, or malformed terminal message produces the same retryable
  technical failure semantics as the current responder.
- A terminal answer is publishable only after all required-before-reply tools
  succeed and all result dispositions permit a response.
- Tool conflict and retry behavior remains bounded and equivalent to the current
  implementation.

### Tracing and privacy

- Automatic LangChain and LangSmith tracing remains disabled.
- Normal invocations create no LangSmith client or callback.
- Exact-content tracing requires the configured isolated Cloud Run revision,
  exact application workspace, and fictional focal-message marker.
- The callback records the full agent run tree, including model and tool spans.
- Trace transport errors expose no content. Flush has a bounded deadline.
- Tracing must not change, retry, or publish a different model outcome.
- Approved-live exact-content tracing is outside this migration.

## Dependency versions

Pin the versions already proven in Parenting Agent unless current compatibility
tests require a newer mutually compatible set:

- `langchain@1.5.9`
- `@langchain/core@1.2.8`
- `@langchain/google@0.2.2`
- existing `langsmith@0.8.9`

Keep any TypeScript compatibility cast inside the private framework seam. Tests
must execute the affected middleware at runtime.

## Testing strategy

Use Vitest and the existing in-memory adapters. Add tests before each behavior
change.

- Contract and Chat tests prove role preservation, chronology, focal exclusion,
  budgets, omission metadata, and legacy-task compatibility.
- Prompt tests prove hostile data never enters the system prompt or grants
  authority.
- Runner tests prove complete tool exchanges, budgets, deadlines, cancellation,
  malformed outputs, and terminal validation.
- Parity tests cover family-map replacement, memory proposal/query dispositions,
  medication grounding, conflict retry, safety refusal, telemetry, deduplication,
  and publication after LINE acceptance.
- LangSmith tests prove default-off behavior, exact fictional gates, environment
  rejection, content-safe failures, complete run-tree callbacks, and outcome
  independence.
- The final gate is `npm run check`, `npm test`, and
  `npm run build --workspace @medbuddy/web`.

## Delivery pieces

1. Add the role-preserving context contract and prompt boundary.
2. Add the framework/model foundation and bounded runner.
3. Adapt all MedBuddy application tools and prove behavioral parity.
4. Replace production composition and add selective agent-level tracing.
5. Remove superseded orchestration and update architecture documentation.

After each piece, a fresh-context subagent must review architecture, code, tests,
and behavior against this specification. Fix all actionable findings before the
next piece starts.

After all pieces, two separate fresh-context subagents must perform:

- a final architecture and external-behavior review;
- a risk-mitigation audit against the complete risk register below.

A third fresh-context subagent must run final verification after remediation.

## Risk register

| Risk | Required mitigation and proof |
| --- | --- |
| Application policy disappears behind framework code | Keep authorization, schemas, trusted scope, dispositions, and safety in application-owned modules; parity tests cover every capability. |
| Framework dependency or type instability | Pin versions, isolate imports, keep compatibility casts private, and run typecheck plus a real framework exchange test. |
| Hidden framework defaults violate invariants | Set retries, tools, middleware, persistence, callbacks, recursion, and deadlines explicitly; negative tests prove absent capabilities. |
| Migration changes final behavior | Reuse existing responder contract tests and add outcome parity scenarios before deleting old code. |
| Provider request becomes opaque | Assert the exact system and ordered message sequence at the `BaseChatModel` seam and inspect fictional LangSmith traces. |
| Tool authorization moves to the model | Bind trusted execution context before tool creation and reject reserved trusted-scope keys in model input. |
| Tool errors leak content or become advice | Sanitize tool errors and fail closed for hard failures. Tests inject hostile errors and malformed outputs. |
| Deadlines and retries expand | Set model retries to zero, use one absolute abort signal, bound each tool, and test hanging model/tool behavior. |
| LangGraph becomes another memory store | Construct no checkpointer or Store. Fresh turns start with application-assembled context only. |
| Tracing captures private live content | Permit only isolated fictional tracing. Reject automatic tracing aliases and fallback-file persistence. |
| Trace failure changes user behavior | Separate model outcome from trace outcome and prove identical responses with trace transport/flush failure. |
| Dependency vulnerabilities increase | Run `npm audit --omit=dev`, identify newly introduced reachable findings, and do not claim completion with an unmitigated new critical path. |

## Success criteria

- One `createAgent()` runtime handles production LINE conversation turns.
- No production responder-version switch or parallel legacy path remains.
- All benefits in the Objective are demonstrated by tests or trace evidence.
- Every behavioral and privacy invariant above has direct verification evidence.
- Existing family-map, memory, medication, continuity, deduplication, and LINE
  publication behavior passes without reduced assertions.
- Independent piece reviews and final risk reviews have no unresolved actionable
  findings.
- Full check, test, build, privacy review, and dependency audit gates pass.

