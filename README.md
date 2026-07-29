# MedBuddy

Fictional-data-only prototype that helps an older adult and authorized family caregivers turn an incomplete post-visit conversation into an attributed, reviewable handoff. Taiwan is the first market; real health data is out of scope.

## Start here (progressive disclosure)

| Order | Open | When |
| --- | --- | --- |
| 1 | [PROTOTYPE_CHALLENGE.md](./PROTOTYPE_CHALLENGE.md) | Delivery contract and medical-safety bounds (binding) |
| 2 | [AGENTS.md](./AGENTS.md) | Always-on agent and contributor rules |
| 3 | [docs/INDEX.md](./docs/INDEX.md) | Doc catalog and when to load deeper material |
| 4 | Package or app `README.md` | Only when editing that package |

Do not load the full PRD or TDD by default. Use [docs/INDEX.md](./docs/INDEX.md) to choose the next file.

## Repository map

```text
apps/web/                 HTTP shell: auth, composition, route adapters
packages/contracts/       Zod schemas, branded IDs, ports, golden fixtures
packages/chat/            Message append, list, capture retry
packages/care-record/     Eligibility, facts, review, handoff
packages/intelligence/    Conversation, capture, safety, medication grounding
packages/platform/        Firestore, Tasks, Storage, in-memory adapters
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

intelligence ──→ contracts   (not yet wired into apps/web)
```

`platform` depends only on `contracts` (+ GCP SDKs); domain policy never lives in adapters.

## Commands

```bash
npm ci
npm test
npm run check          # typecheck + lint
make help              # Terraform targets for infra/
```

See package READMEs and [docs/ops notes via INDEX](./docs/INDEX.md) for deployment and adapter details.

## Documentation

- Product: [docs/PRD.md](./docs/PRD.md)
- Architecture skim: [docs/engineering/ARCHITECTURE.md](./docs/engineering/ARCHITECTURE.md)
- Full technical design: [docs/TDD.md](./docs/TDD.md)
- Infra: [infra/README.md](./infra/README.md)
