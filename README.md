# MedBuddy

MedBuddy is becoming an AI participant in an existing family conversation without making medical decisions.

The current LINE prototype maps verified DM/group/room events to isolated workspaces, preserves an immutable continuity ledger, supplies bounded recent and progressively compacted attributed history plus one bounded family map to Vertex, and publishes MedBuddy output as evidence only after LINE accepts it. Private tasks compact history and ingest validated attachments. The model still has no repository access or authority to write medical facts. See [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md).

## Start here (progressive disclosure)

| Order | Open | When |
| --- | --- | --- |
| 1 | [PRODUCT_DIRECTION.md](./PRODUCT_DIRECTION.md) | Current goal, priorities, and locked alpha decisions |
| 2 | [PROTOTYPE_CHALLENGE.md](./PROTOTYPE_CHALLENGE.md) | Historical brief; medical-safety bounds remain binding |
| 3 | [AGENTS.md](./AGENTS.md) | Always-on agent and contributor rules |
| 4 | [docs/INDEX.md](./docs/INDEX.md) | Doc catalog and when to load deeper material |
| 5 | Package or app `README.md` | Only when editing that package |

Do not load the full PRD or TDD by default. Use [docs/INDEX.md](./docs/INDEX.md) to choose the next file.

## Repository map

```text
apps/web/                 HTTP shell: auth, composition, route adapters
packages/contracts/       Zod schemas, branded IDs, ports, golden fixtures
packages/chat/            Message workflows, isolated LINE turns, family-map binding
packages/care-record/     Eligibility, facts, review, handoff
packages/intelligence/    Bounded agent loop, Vertex tools, safety, capture, grounding
packages/platform/        Firestore/in-memory family maps, Tasks, Storage
docs/                     Product, engineering, ops, discovery
infra/                    Terraform prototype foundation
tasks/                    Execution plan and checklist (not product specs)
```

Dependency direction (arrow points from dependent to dependency):

```text
apps/web ──→ contracts
        ──→ chat ──→ care-record ──→ contracts
        ──→ care-record
        ──→ platform ──→ contracts
        ──→ intelligence ──→ contracts
```

`platform` depends only on `contracts` (+ GCP SDKs); domain policy never lives in adapters.

## Commands

```bash
npm ci
npm exec playwright install chromium
npm run dev           # local fictional demo at http://localhost:3000
npm run smoke:line    # synthetic signed LINE conversation proof; no credentials
npm test
npm run check          # typecheck + lint
npm run test:e2e      # isolated browser smoke test at http://localhost:3100
make help              # Terraform targets for infra/
```

The local browser host requires no environment file, cloud account, external credentials, or deployment. See
[`apps/web/README.md`](./apps/web/README.md) for the fictional sign-in details and manual verification flow.
It remains useful for automated verification, but it is not the current product-delivery priority.
See package READMEs and [docs/ops notes via INDEX](./docs/INDEX.md) for deployment and adapter details.

## Documentation

- Current direction: [PRODUCT_DIRECTION.md](./PRODUCT_DIRECTION.md)
- Current LINE prototype spec: [docs/LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md](./docs/LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md)
- Implemented family-map design: [docs/proposals/WORKSPACE_FAMILY_MAP_DESIGN.md](./docs/proposals/WORKSPACE_FAMILY_MAP_DESIGN.md)
- LINE console and live fictional-smoke setup: [docs/LINE_SETUP.md](./docs/LINE_SETUP.md)
- Superseded Telegram family-alpha spec: [docs/TELEGRAM_FAMILY_ALPHA_SPEC.md](./docs/TELEGRAM_FAMILY_ALPHA_SPEC.md)
- Earlier product PRD: [docs/PRD.md](./docs/PRD.md)
- Architecture skim: [docs/engineering/ARCHITECTURE.md](./docs/engineering/ARCHITECTURE.md)
- Full technical design: [docs/TDD.md](./docs/TDD.md)
- Current implementation roadmap: [tasks/plan.md](./tasks/plan.md)
- Infra: [infra/README.md](./infra/README.md)
