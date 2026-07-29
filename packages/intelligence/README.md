# `@medbuddy/intelligence`

Probabilistic and bounded-model surfaces: conversation responder, capture processing, safety routing, and committed medication grounding.

## Public entry

- `.` → capture, conversation, safety, grounding, fixed/Vertex model adapters, fixture grounding helper

## Depends on

- `@medbuddy/contracts`
- `google-auth-library` (Vertex adapter)

## Must not

- Authoritatively mutate accepted facts, consent, or membership
- Recommend starting, stopping, or changing medication
- Answer patient-specific drug questions from model memory (use cited source cards)

## Fixtures

- `fixtures/medication/` — committed medication source cards for deterministic grounding

## Tests

```bash
npm test --workspace @medbuddy/intelligence
```

Vertex live smoke is opt-in at the repo root (`npm run test:vertex-smoke`).

## Composition note

Not yet declared as a dependency of `@medbuddy/web`; wire through the app composition root when attaching conversation and capture handlers.
