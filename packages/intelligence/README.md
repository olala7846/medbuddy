# `@medbuddy/intelligence`

Probabilistic and bounded-model surfaces: bounded model/tool/model conversation loop, Vertex family-map function transport, capture processing, safety routing, and committed medication grounding.

## Public entry

- `.` → capture, conversation, safety, grounding, fixed/Vertex model adapters, fixture grounding helper

## Depends on

- `@medbuddy/contracts`
- `google-auth-library` (Vertex adapter)

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

The family-map prompt keeps one readable raw-text document with `Participants`,
`Named relatives`, and `Direct relationships` sections. Explicitly named
relatives need not be LINE participants; indirect relationships remain
response-time inferences rather than stored facts.

## Composition note

`@medbuddy/web` composes the direct Vertex adapter for LINE. Chat supplies the
server-bound family-map capability; Intelligence never receives persistence.
Deterministic medical refusals and the narrow ambiguous-pronoun relationship
guard run before the model/tool loop.
