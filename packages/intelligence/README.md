# `@medbuddy/intelligence`

Probabilistic and bounded-model surfaces: one bounded LangChain `createAgent()`
conversation runtime, Vertex capture and compaction transport, safety routing,
and committed medication grounding.

## Public entry

- `.` → production `createAgent()` composition, capture, safety, grounding,
  fixed/Vertex support adapters, and fixture grounding helper
- `./legacy-testing` → pre-migration custom-loop parity and opt-in evaluation
  harnesses only; production modules must not import this subpath
- Passive memory uses a dedicated JSON-only generator with no tools or reply surface.

## Depends on

- `@medbuddy/contracts`
- `langchain`, `@langchain/core`, and `@langchain/google`
- `google-auth-library` (Vertex adapter)
- `langsmith` (default-off exact-content verification tracing)

## Must not

- Authoritatively mutate accepted facts, consent, or membership
- Recommend starting, stopping, or changing medication
- Answer patient-specific drug questions from model memory (use cited source cards)
- Receive repositories, Firestore handles, workspace selection, or medical write authority

## Fixtures

- `fixtures/medication/` — committed medication source cards for deterministic grounding

## Tests

```bash
npm test --workspace @medbuddy/intelligence
```

Vertex live smoke and family-map behavior evaluations are opt-in at the repo root
(`npm run test:vertex-smoke`) and use fictional inputs only.

The compaction semantic evaluation is also opt-in and fictional-only. It calls
the configured Vertex project with `gemini-3.5-flash-lite` and checks correction,
attribution, unresolved-loop, safety-caveat, and hierarchical-compaction
behavior with deterministic assertions:

```bash
MEDBUDDY_VERTEX_PROJECT=<project-id> npm run eval:compaction
```

The LINE responder builds one invocation-local agent. Stable application rules
are in the system prompt. The first user message is a versioned JSON recap;
later user and assistant messages preserve their original roles, and each human
message carries its application-supplied opaque author ID; the attributed focal
turn appears once. Deterministic medical refusals and application-owned tool
authorization run outside the framework. The runner configures no LangGraph
checkpointer or Store and starts each invocation only from application context.

Agent-level LangSmith tracing is default-off. It requires an exact isolated
Cloud Run revision, an exact fictional application workspace, and the matching
fictional marker at the start of the focal message. The callback records the
agent, model, and tool run tree. Each session permits one discovery and one
ingest request, cancels transport at the turn deadline, refuses fallback-file
persistence, and cannot change the model outcome. The older explicitly wrapped
`VertexModelClient` tracer remains available for fictional compaction checks.
Text capture, image extraction, and attachment ingestion remain untraced.

The family-map prompt keeps one readable raw-text document with `Participants`,
`Named relatives`, and `Direct relationships` sections. Explicitly named
relatives need not be LINE participants; indirect relationships remain
response-time inferences rather than stored facts.

## Composition note

`@medbuddy/web` composes `createVertexCreateAgentResponder()` as the only LINE
conversation runtime. Chat supplies the
server-bound family-map and current dynamic-memory capabilities; Intelligence
never receives persistence or workspace selection authority.
The historical custom loop is not exported from the production entry point.
