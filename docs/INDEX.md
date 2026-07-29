# Documentation index

Load only what the current task needs. Prefer short maps over whole specs.

## Agent and contributor defaults

1. [../PROTOTYPE_CHALLENGE.md](../PROTOTYPE_CHALLENGE.md) — delivery and safety contract
2. [../AGENTS.md](../AGENTS.md) — workflow, privacy, language
3. [../README.md](../README.md) — repo map and commands
4. This file — pick the next doc by task type
5. Relevant package or app `README.md` when editing code there

## By task

| Task | Read first | Go deeper only if needed |
| --- | --- | --- |
| Orient to the product | [PRD.md](./PRD.md) §§1–3 (summary + users) | Full [PRD.md](./PRD.md); [discovery/](./discovery/) |
| Package boundaries / deps | [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) | [TDD.md](./TDD.md) §4–5, §17 |
| Implement a workflow | ARCHITECTURE + owning package README | [TDD.md](./TDD.md) matching section; [../tasks/todo.md](../tasks/todo.md) |
| Safety / medication limits | PROTOTYPE_CHALLENGE + ARCHITECTURE trust boundaries | TDD §5; `packages/intelligence` README |
| Deploy or GCP adapters | [infra/README.md](../infra/README.md) | [DEPLOYMENT_READINESS.md](./DEPLOYMENT_READINESS.md), [GCP_ADAPTERS.md](./GCP_ADAPTERS.md) |
| Why a product decision exists | [discovery/prd-decision-log.md](./discovery/prd-decision-log.md) | [discovery/product-intent.md](./discovery/product-intent.md) |
| Execution status | [../tasks/todo.md](../tasks/todo.md) | [../tasks/plan.md](../tasks/plan.md) |

## Catalog

### Product

| Doc | Role | Size note |
| --- | --- | --- |
| [PRD.md](./PRD.md) | Approved product requirements | Long; use INDEX sections first |
| [discovery/product-intent.md](./discovery/product-intent.md) | Confirmed product intent (EN) | Medium |
| [discovery/product-intent.zh-TW.md](./discovery/product-intent.zh-TW.md) | Traditional Chinese intent backup | Medium |
| [discovery/prd-decision-log.md](./discovery/prd-decision-log.md) | Decision log from discovery | Long |

### Engineering

| Doc | Role | Size note |
| --- | --- | --- |
| [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) | Package map, deps, trust boundaries, as-built tree | Short default eng entry |
| [TDD.md](./TDD.md) | Full technical design | Very long; do not load whole file by default |
| Package `README.md` files under `packages/*` and `apps/web` | Edit-scoped API and invariants | Short |

### Operations

| Doc | Role |
| --- | --- |
| [../infra/README.md](../infra/README.md) | Terraform bootstrap and foundation |
| [DEPLOYMENT_READINESS.md](./DEPLOYMENT_READINESS.md) | Deployment blockers and readiness |
| [GCP_ADAPTERS.md](./GCP_ADAPTERS.md) | Client/adapter operational notes |

### Execution (not specs)

| Doc | Role |
| --- | --- |
| [../tasks/plan.md](../tasks/plan.md) | Parallel implementation plan |
| [../tasks/todo.md](../tasks/todo.md) | Checklist and verify commands |

## As-built vs older diagrams

Some sections of [TDD.md](./TDD.md) and [tasks/plan.md](../tasks/plan.md) still describe a target layout (`fixtures/` at repo root, root `tests/`, Next.js `app/`). The **as-built** tree is in [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) and the root [README.md](../README.md). Prefer as-built when navigating the repo; treat unmatched target paths as deferred, not missing by accident.
