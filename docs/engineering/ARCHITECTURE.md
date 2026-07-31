# MedBuddy architecture (as-built)

> **Current target:** Reuse this modular foundation for the live Telegram
> family alpha defined in [`../../PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md)
> and [`../TELEGRAM_FAMILY_ALPHA_SPEC.md`](../TELEGRAM_FAMILY_ALPHA_SPEC.md).
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
| `@medbuddy/chat` | `ChatService`: append/list messages, capture retry | Storage vendor details |
| `@medbuddy/care-record` | Eligibility, facts, review, handoff, authorization helpers | Model prompts, HTTP |
| `@medbuddy/intelligence` | Conversation responder, capture processing, safety routing, medication grounding | Canonical fact mutation authority, consent grants |
| `@medbuddy/platform` | Firestore, Cloud Tasks, Storage, in-memory adapters, demo workspace persistence | Consent, safety, review, handoff **policy** |
| `@medbuddy/web` | Auth/actor resolution, HTTP/route adapters, composition root | Canonical business policy (target; some orchestration still lives here) |

## Dependency direction

Arrow points from dependent to dependency:

```text
@medbuddy/web ──→ contracts
            ──→ chat ──→ care-record ──→ contracts
            ──→ care-record
            ──→ platform ──→ contracts

@medbuddy/intelligence ──→ contracts   (not yet wired into web)
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
| Conversational agent | Friendly reply, read-only med lookup, request follow-up/handoff prep | Mutate facts, grant access, resolve conflicts, advise med changes |
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
- Telegram webhook, Bot API adapter, command flow, and live channel composition

Tests live next to each package (`packages/*/tests`, `apps/web/tests`).

## Composition note

`@medbuddy/web` currently depends on `care-record`, `chat`, `contracts`, and `platform`. `@medbuddy/intelligence` is implemented and tested but not yet a workspace dependency of the web app; wire it through the composition root when connecting conversation and capture handlers end-to-end.

## Where to go next

| Need | Doc |
| --- | --- |
| Full flows, data model, deployment design | [../TDD.md](../TDD.md) |
| Ops / Terraform | [../../infra/README.md](../../infra/README.md) |
| Task checklist | [../../tasks/todo.md](../../tasks/todo.md) |
| Doc catalog | [../INDEX.md](../INDEX.md) |
