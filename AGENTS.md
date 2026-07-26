# Project Principles

- Read `PROTOTYPE_CHALLENGE.md` before planning or implementation. Treat its delivery contract and medical-safety requirements as binding.
- Design for no more than 100 users unless supporting more is equally simple. Prefer hosted serverless services, a monolith, or one sufficiently large machine. Avoid microservices, orchestration, and speculative scaling.
- Deliver incremental user value and validate assumptions early. Build the smallest user-facing end-to-end proof of concept first; add complex backend systems only after the workflow and value are demonstrated.
- Avoid over-engineering and speculative abstractions. Prefer simple, reversible decisions that fit the prototype timeline.

## Privacy and Public Repository Hygiene

- Assume repository and submission artifacts may become public. Never commit personally identifiable information (PII), protected or sensitive health information, credentials, or raw interview material that could identify a participant or family.
- Minimize and anonymize user-research evidence. Preserve the product-relevant event, behavior, and insight while removing names, exact diagnoses, contact details, dates, locations, and distinctive combinations that are not essential to the product decision.
- Label anonymized, composite, hypothetical, and market-level evidence accurately. Never present a personal anecdote as a general market fact.
- Obtain explicit user consent before committing any identifiable personal or medical detail, even when the user shared it in chat. Prefer an abstracted or fictionalized example whenever identity is unnecessary.
- Review staged changes for PII, health information, and secrets before every commit.

## Development Workflow

- Start every change from an up-to-date `origin/main` in a clean Git worktree and dedicated feature branch.
- Never implement or merge changes directly on local `main` or `master`.
- Make small, logical commits as work progresses and preserve their full history. Do not rewrite published commits.
- Finish every change through a pull request and merge it into `origin/main` with a merge commit. Never squash or rebase PR commits, and do not merge feature branches into a local default branch.
- After a merge, fetch `origin/main` before creating the next worktree.
