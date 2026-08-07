# Project Principles

- Read `PRODUCT_DIRECTION.md` before planning or implementation. Treat its priority order and live-family goal as binding.
- Read `PROTOTYPE_CHALLENGE.md` for historical context. Its medical-safety requirements remain binding; its expired deadline and reviewer-oriented deliverables do not override the current product direction.
- Design for no more than 100 users unless supporting more is equally simple. Prefer hosted serverless services, a monolith, or one sufficiently large machine. Avoid microservices, orchestration, and speculative scaling.
- Deliver incremental user value and validate assumptions early. Build the smallest user-facing end-to-end proof of concept first; add complex backend systems only after the workflow and value are demonstrated.
- Avoid over-engineering and speculative abstractions. Prefer simple, reversible decisions that fit the prototype timeline.

## Documentation discovery (progressive disclosure)

Load documentation in this order. Stop when the task has enough context.

1. `PRODUCT_DIRECTION.md` — current goal and priority order
2. `PROTOTYPE_CHALLENGE.md` — historical brief and binding medical-safety contract
3. This file — always-on project rules
4. `README.md` — purpose, repo map, commands
5. `docs/INDEX.md` — choose the next doc by task type
6. Package or app `README.md` only when editing that package
7. `docs/engineering/ARCHITECTURE.md` for package boundaries and as-built layout

Do **not** load full `docs/PRD.md` or `docs/TDD.md` by default. Open specific sections only when product requirements or deep design detail are required. Prefer as-built maps in `README.md` and `docs/engineering/ARCHITECTURE.md` over older target trees inside the TDD or `tasks/plan.md`.

## Current Delivery Priority

- Deliver the Telegram message-to-fact-to-review-to-visit-brief vertical path before presentation polish, additional channels, or speculative infrastructure.
- Treat the existing fake-backed web application as a test harness and reference surface, not the primary product.
- Do not polish or expand the web demo unless the work directly enables, verifies, or operates the live Telegram family alpha.
- Use `docs/TELEGRAM_FAMILY_ALPHA_SPEC.md` for requirements and `tasks/plan.md` plus `tasks/todo.md` for execution.

## Privacy and Public Repository Hygiene

- Assume repository and submission artifacts may become public. Never commit personally identifiable information (PII), protected or sensitive health information, credentials, or raw interview material that could identify a participant or family.
- Minimize and anonymize user-research evidence. Preserve the product-relevant event, behavior, and insight while removing names, exact diagnoses, contact details, dates, locations, and distinctive combinations that are not essential to the product decision.
- Label anonymized, composite, hypothetical, and market-level evidence accurately. Never present a personal anecdote as a general market fact.
- Obtain explicit user consent before committing any identifiable personal or medical detail, even when the user shared it in chat. Prefer an abstracted or fictionalized example whenever identity is unnecessary.
- Review staged changes for PII, health information, and secrets before every commit.
- Real family data may exist only in an explicitly approved private runtime after the live-data safety checkpoint. Never place it in repository files, fixtures, tests, logs, screenshots, issues, pull requests, or build artifacts.

## Working Language and Context Preservation

- Use English by default for project discussions, documentation, source code, code comments, commit messages, and pull requests.
- Use Traditional Chinese only for a specific discussion where preserving the exact original context or meaning requires it.
- When that exception applies, preserve a Traditional Chinese backup of the relevant discussion before translating or summarizing it. The backup must follow the privacy and public-repository rules above.
- Unless the user explicitly requests otherwise, keep English as the canonical language for resulting documentation and implementation.

## Development Workflow

- Start every change from an up-to-date `origin/main` in a clean Git worktree and dedicated feature branch.
- Create manually managed MedBuddy worktrees under `~/.codex/worktrees`; never create sibling worktrees under `~/repositories` or inside this repository. Codex-managed worktrees use the Worktree root configured in Codex desktop Settings.
- Never implement or merge changes directly on local `main` or `master`.
- Make small, logical commits as work progresses and preserve their full history. Do not rewrite published commits.
- Finish every change through a pull request and merge it into `origin/main` with a merge commit. Never squash or rebase PR commits, and do not merge feature branches into a local default branch.
- After a merge, fetch `origin/main` before creating the next worktree.
