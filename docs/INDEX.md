# Documentation index

Load only what the current task needs. Prefer short maps over whole specs.

## Agent and contributor defaults

1. [../PRODUCT_DIRECTION.md](../PRODUCT_DIRECTION.md) — current goal and priority order
2. [../PROTOTYPE_CHALLENGE.md](../PROTOTYPE_CHALLENGE.md) — historical brief and binding safety contract
3. [../AGENTS.md](../AGENTS.md) — workflow, privacy, language
4. [../README.md](../README.md) — repo map and commands
5. This file — pick the next doc by task type
6. Relevant package or app `README.md` when editing code there

## By task

| Task | Read first | Go deeper only if needed |
| --- | --- | --- |
| Orient to the product | [../PRODUCT_DIRECTION.md](../PRODUCT_DIRECTION.md) | [TELEGRAM_FAMILY_ALPHA_SPEC.md](./TELEGRAM_FAMILY_ALPHA_SPEC.md); earlier [PRD.md](./PRD.md) |
| Implement the current alpha | [TELEGRAM_FAMILY_ALPHA_SPEC.md](./TELEGRAM_FAMILY_ALPHA_SPEC.md) | [../tasks/plan.md](../tasks/plan.md); owning package README |
| Review the proposed agent memory architecture | [proposals/AGENT_MEMORY_ARCHITECTURE.md](./proposals/AGENT_MEMORY_ARCHITECTURE.md) | [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md); current Intelligence and Chat packages |
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
| [../PRODUCT_DIRECTION.md](../PRODUCT_DIRECTION.md) | Canonical product goal and priorities | Short; read first |
| [TELEGRAM_FAMILY_ALPHA_SPEC.md](./TELEGRAM_FAMILY_ALPHA_SPEC.md) | Approved current product and implementation specification | Medium; current source of requirements |
| [PRD.md](./PRD.md) | Earlier caregiver-handoff product requirements | Long; historical context |
| [discovery/product-intent.md](./discovery/product-intent.md) | Confirmed product intent (EN) | Medium |
| [discovery/product-intent.zh-TW.md](./discovery/product-intent.zh-TW.md) | Traditional Chinese intent backup | Medium |
| [discovery/prd-decision-log.md](./discovery/prd-decision-log.md) | Decision log from discovery | Long |

### Engineering

| Doc | Role | Size note |
| --- | --- | --- |
| [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) | Package map, deps, trust boundaries, as-built tree | Short default eng entry |
| [TDD.md](./TDD.md) | Full technical design | Very long; do not load whole file by default |
| Package `README.md` files under `packages/*` and `apps/web` | Edit-scoped API and invariants | Short |

### Decisions

| Doc | Role |
| --- | --- |
| [decisions/0001-prioritize-live-telegram-family-alpha.md](./decisions/0001-prioritize-live-telegram-family-alpha.md) | Why live Telegram family value supersedes web-demo polish |

### Proposals

| Doc | Role |
| --- | --- |
| [proposals/AGENT_MEMORY_ARCHITECTURE.md](./proposals/AGENT_MEMORY_ARCHITECTURE.md) | Proposed memory layers, retrieval policy, implementation sequence, and framework/GCP choices |
| [proposals/WORKSPACE_FAMILY_MAP_DESIGN.md](./proposals/WORKSPACE_FAMILY_MAP_DESIGN.md) | Proposed LINE workspace family-map behavior, tool seam, persistence, and verification contract |

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

## As-built vs deferred target paths

The **as-built** tree is in [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) and the root [README.md](../README.md). The earlier [TDD.md](./TDD.md) contains historical target paths and partially aspirational commands; use the Telegram family-alpha spec and current package metadata for new work.
