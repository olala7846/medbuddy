# MedBuddy architecture (as-built)

> **Current target:** Reuse this modular foundation for the LINE-first
> conversational prototype defined in [`../../PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md)
> and [`../LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md`](../LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md).
> The fake-backed web host is a verification surface, not the product priority.

**Audience:** engineers and agents touching code structure  
**Deeper design:** [../TDD.md](../TDD.md)  
**Product intent:** [../PRD.md](../PRD.md)

## Shape

One npm-workspace **modular monolith**: one lockfile, packages for domain and adapters, and one web application with a runnable local Next.js host.

Designed for ≤100 users. No microservices.

## Packages

| Package | Owns | Must not own |
| --- | --- | --- |
| `@medbuddy/contracts` | Zod schemas, branded IDs, errors, public ports, golden scenario fixtures | Runtime I/O, policy decisions |
| `@medbuddy/chat` | Chat workflows, isolated external turns, family-map context and turn-bound update capability | Storage vendor and channel details |
| `@medbuddy/care-record` | Eligibility, facts, review, handoff, authorization helpers | Model prompts, HTTP |
| `@medbuddy/intelligence` | Bounded model/tool/model loop, Vertex function transport, capture, safety, medication grounding | Repositories, canonical fact mutation authority, consent grants |
| `@medbuddy/platform` | Firestore and in-memory family-map adapters, Cloud Tasks, Storage, demo persistence | Consent, safety, review, handoff **policy** |
| `@medbuddy/web` | Auth/actor resolution, LINE and browser HTTP adapters, composition root | Canonical business policy (target; some orchestration still lives here) |

## Dependency direction

Arrow points from dependent to dependency:

```text
@medbuddy/web ──→ contracts
            ──→ chat ──→ care-record ──→ contracts
            ──→ care-record
            ──→ platform ──→ contracts

@medbuddy/web ──→ intelligence ──→ contracts
```

`platform` depends only on `contracts` and GCP SDKs.

Rules:

- Every module may import `@medbuddy/contracts` (public entry only).
- Import another package only through its package `exports` entry, not deep paths.
- `apps/web` composes and translates HTTP; domain packages stay free of Next/request types where possible.
- `platform` implements I/O seams; in-memory adapters are first-class test implementations.
- Prefer package READMEs when changing one package.

## Trust boundaries (short)

| Surface | May | Must not |
| --- | --- | --- |
| Browser | Display, input, demo persona header (when allowed), poll | Write DB/storage directly; decide authz or safety |
| Conversational agent | Reply after deterministic refusal; call the one server-bound family-map replacement tool | Access repositories/another workspace, mutate medical facts, grant access, advise medication changes |
| LINE webhook | Verify raw body, validate provider event, derive opaque IDs, reply with event token | Parse before verification; log content, tokens, or provider identifiers |
| Capture pipeline | Propose candidate facts from a focal message | Skip validation, invent provenance, process pre-approval history as approved |
| Deterministic domain services | Consent eligibility, authz, review, handoff immutability, refusals | Defer those decisions to the model |

## As-built tree

```text
apps/web/src/                 Auth, composition, chat/review route adapters
packages/contracts/src/       Schemas + ports; fixtures under packages/contracts/fixtures/
packages/chat/src/
packages/care-record/src/
packages/intelligence/src/    capture/, conversation/, grounding/, safety/, adapters/
packages/intelligence/fixtures/medication/
packages/platform/src/        firestore/, cloud-tasks/, storage/, in-memory/, demo-workspace/
docs/                         PRD, TDD, ops notes, discovery/, engineering/
infra/terraform/              bootstrap/, prototype/
tasks/                        plan.md, todo.md
```

**Not present yet:**

- Root `fixtures/`, `scripts/`, `tests/{unit,integration,e2e}`
- Root medication snapshot script
- Rolling conversation summaries, retrieval memory, additional agent tools, and specialized medical conversation

Tests live next to each package (`packages/*/tests`, `apps/web/tests`).

## Composition note

`@medbuddy/web` composes the LINE boundary with Chat, Intelligence, and Platform. Chat binds workspace, actor, and source-message scope before exposing the family-map capability. Provider and channel types terminate at their adapters; the conversation interface remains channel-neutral.

## Where to go next

| Need | Doc |
| --- | --- |
| Full flows, data model, deployment design | [../TDD.md](../TDD.md) |
| Ops / Terraform | [../../infra/README.md](../../infra/README.md) |
| Task checklist | [../../tasks/todo.md](../../tasks/todo.md) |
| Doc catalog | [../INDEX.md](../INDEX.md) |
