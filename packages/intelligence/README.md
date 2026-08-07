# `@medbuddy/intelligence`

Probabilistic and bounded-model surfaces: bounded model/tool/model conversation loop, Vertex family-map and dynamic-memory function transport, capture processing, safety routing, and committed medication grounding.

## Public entry

- `.` → capture, conversation, safety, grounding, fixed/Vertex model adapters, fixture grounding helper
- Passive memory uses a dedicated JSON-only generator with no tools or reply surface.

## Depends on

- `@medbuddy/contracts`
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

The optional LangSmith adapter wraps only explicitly composed conversation and
compaction `VertexModelClient` instances. It requires an exact allowlisted
fictional workspace match, refuses inline image data, attempts to flush before
the serverless request finishes with a bounded two-second wait, and never changes or
retries the underlying Vertex result when trace export fails. Text capture,
image extraction, and attachment ingestion remain untraced. A flush timeout can
therefore lose a verification trace without changing the model outcome.

The family-map prompt keeps one readable raw-text document with `Participants`,
`Named relatives`, and `Direct relationships` sections. Explicitly named
relatives need not be LINE participants; indirect relationships remain
response-time inferences rather than stored facts.

## Composition note

`@medbuddy/web` composes the direct Vertex adapter for LINE. Chat supplies the
server-bound family-map and current dynamic-memory capabilities; Intelligence
never receives persistence or workspace selection authority.
Deterministic medical refusals and the narrow ambiguous-pronoun relationship
guard run before the model/tool loop.
