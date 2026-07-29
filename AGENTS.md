# Project Principles

- Read `PROTOTYPE_CHALLENGE.md` before planning or implementation. Treat its delivery contract and medical-safety requirements as binding.
- Design for no more than 100 users unless supporting more is equally simple. Prefer hosted serverless services, a monolith, or one sufficiently large machine. Avoid microservices, orchestration, and speculative scaling.
- Deliver incremental user value and validate assumptions early. Build the smallest user-facing end-to-end proof of concept first; add complex backend systems only after the workflow and value are demonstrated.
- Avoid over-engineering and speculative abstractions. Prefer simple, reversible decisions that fit the prototype timeline.

## Documentation discovery (progressive disclosure)

Load documentation in this order. Stop when the task has enough context.

1. `PROTOTYPE_CHALLENGE.md` — delivery and medical-safety contract
2. This file — always-on project rules
3. `README.md` — purpose, repo map, commands
4. `docs/INDEX.md` — choose the next doc by task type
5. Package or app `README.md` only when editing that package
6. `docs/engineering/ARCHITECTURE.md` for package boundaries and as-built layout

Do **not** load full `docs/PRD.md` or `docs/TDD.md` by default. Open specific sections only when product requirements or deep design detail are required. Prefer as-built maps in `README.md` and `docs/engineering/ARCHITECTURE.md` over older target trees inside the TDD or `tasks/plan.md`.

## Privacy and Public Repository Hygiene

- Assume repository and submission artifacts may become public. Never commit personally identifiable information (PII), protected or sensitive health information, credentials, or raw interview material that could identify a participant or family.
- Minimize and anonymize user-research evidence. Preserve the product-relevant event, behavior, and insight while removing names, exact diagnoses, contact details, dates, locations, and distinctive combinations that are not essential to the product decision.
- Label anonymized, composite, hypothetical, and market-level evidence accurately. Never present a personal anecdote as a general market fact.
- Obtain explicit user consent before committing any identifiable personal or medical detail, even when the user shared it in chat. Prefer an abstracted or fictionalized example whenever identity is unnecessary.
- Review staged changes for PII, health information, and secrets before every commit.

## Working Language and Context Preservation

- Use English by default for project discussions, documentation, source code, code comments, commit messages, and pull requests.
- Use Traditional Chinese only for a specific discussion where preserving the exact original context or meaning requires it.
- When that exception applies, preserve a Traditional Chinese backup of the relevant discussion before translating or summarizing it. The backup must follow the privacy and public-repository rules above.
- Unless the user explicitly requests otherwise, keep English as the canonical language for resulting documentation and implementation.

## Development Workflow

- Start every change from an up-to-date `origin/main` in a clean Git worktree and dedicated feature branch.
- Never implement or merge changes directly on local `main` or `master`.
- Make small, logical commits as work progresses and preserve their full history. Do not rewrite published commits.
- Finish every change through a pull request and merge it into `origin/main` with a merge commit. Never squash or rebase PR commits, and do not merge feature branches into a local default branch.
- After a merge, fetch `origin/main` before creating the next worktree.
