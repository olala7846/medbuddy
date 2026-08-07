# MedBuddy architecture (as-built)

**Current target:** Reuse this foundation for the LINE-first prototype in
[`../../PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) and
[`../LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md`](../LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md).
The fake-backed web host verifies the system. It is not the product priority.
**Audience:** engineers and agents who change code structure.
See [../TDD.md](../TDD.md) for design and [../PRD.md](../PRD.md) for intent.

## System shape

One npm-workspace modular monolith: one lockfile, domain and adapter packages,
and a runnable local Next.js host. Design for 100 users or fewer. No microservices.

## Package responsibilities

| Package | Owns | Must not own |
| --- | --- | --- |
| `@medbuddy/contracts` | Zod schemas, branded IDs, errors, public ports, golden-scenario fixtures | Runtime I/O, policy decisions |
| `@medbuddy/chat` | Chat workflows, isolated external turns, family-map context, deterministic source-backed dynamic-memory policy | Storage vendor, channel details |
| `@medbuddy/care-record` | Eligibility, facts, review, handoff, authorization helpers | Model prompts, HTTP |
| `@medbuddy/intelligence` | Bounded model/tool/model loop, Vertex function transport, capture, safety, medication grounding | Repositories, canonical fact mutation authority, consent grants |
| `@medbuddy/platform` | Firestore and in-memory family-map adapters, Cloud Tasks, Storage, demo persistence | Consent, safety, review, handoff policy |
| `@medbuddy/web` | Auth/actor resolution, LINE and browser HTTP adapters, composition root | Canonical business policy (target; some orchestration remains here) |

## Dependencies and module rules

Arrows point from dependent to dependency.

```text
@medbuddy/web ──→ contracts
            ──→ chat ──→ care-record ──→ contracts
            ──→ care-record
            ──→ platform ──→ contracts

@medbuddy/web ──→ intelligence ──→ contracts
```

`platform` depends only on `contracts` and GCP SDKs.

- Every module can import the public `@medbuddy/contracts` entry.
- Import other packages only through `exports`, never deep paths.
- `apps/web` composes services and translates HTTP. Keep domain packages free of
  Next.js and request types where possible.
- `platform` provides I/O seams; its in-memory adapters are first-class tests.
- Read the package README before you change a package.

## Trust boundaries

| Surface | May | Must not |
| --- | --- | --- |
| Browser | Display, input, allowed demo-persona header, poll | Write DB/storage directly; decide authz or safety |
| Conversational agent | Reply after deterministic refusal; call server-bound family-map replacement and current dynamic-memory proposal/query tools | Access repositories/another workspace; search raw history or reviewed care; mutate medical facts; grant access; advise medication changes |
| LINE webhook | Verify raw body, validate provider events, derive opaque IDs, reply with event token | Parse before verification; log content, tokens, provider identifiers |
| Capture pipeline | Propose candidate facts from a focal message | Skip validation, invent provenance, process pre-approval history as approved |
| Passive memory worker | Read one leased workspace range; submit structured, source-bound proposals | Reply; call LINE/active responders; read attachments/compaction/family maps; schedule itself |
| Deterministic domain services | Consent eligibility, authz, review, handoff immutability, refusals | Defer decisions to the model |

## Repository layout

```text
apps/web/src/                 Auth, composition, chat/review route adapters
packages/contracts/src/       Schemas + ports; fixtures: packages/contracts/fixtures/
packages/chat/src/
packages/care-record/src/
packages/intelligence/src/    capture/, conversation/, grounding/, safety/, adapters/
packages/intelligence/fixtures/medication/
packages/platform/src/        firestore/, cloud-tasks/, storage/, in-memory/, demo-workspace/
docs/                         PRD, TDD, ops notes, discovery/, engineering/
infra/terraform/              bootstrap/, prototype/
tasks/                        plan.md, todo.md
```

Tests: `packages/*/tests` and `apps/web/tests`.

**Not present yet:**

- Root `fixtures/`, `scripts/`, `tests/{unit,integration,e2e}` directories.
- Root medication-snapshot script.
- Reviewed-care retrieval, semantic/vector retrieval, private participant memory,
  or specialized medical conversation.

## Composition

`@medbuddy/web` composes the LINE boundary with Chat, Intelligence, and
Platform. Chat binds workspace, actor, and source-message scope before it
exposes the family-map capability. Provider and channel types end at adapters.
The conversation interface stays channel-neutral.

## Related documents

| Need | Document |
| --- | --- |
| Full flows, data model, deployment design | [../TDD.md](../TDD.md) |
| Operations and Terraform | [../../infra/README.md](../../infra/README.md) |
| Task checklist | [../../tasks/todo.md](../../tasks/todo.md) |
| Document catalog | [../INDEX.md](../INDEX.md) |
