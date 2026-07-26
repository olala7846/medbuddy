# Project Principles

- Read `PROTOTYPE_CHALENGE.md` before planning or implementation. Treat its delivery contract and medical-safety requirements as binding.
- Design for no more than 100 users unless supporting more is equally simple. Prefer hosted serverless services, a monolith, or one sufficiently large machine. Avoid microservices, orchestration, and speculative scaling.
- Deliver incremental user value and validate assumptions early. Build the smallest user-facing end-to-end proof of concept first; add complex backend systems only after the workflow and value are demonstrated.
- Avoid over-engineering and speculative abstractions. Prefer simple, reversible decisions that fit the prototype timeline.

## Development Workflow

- Start every change from an up-to-date `origin/main` in a clean Git worktree and dedicated feature branch.
- Never implement or merge changes directly on local `main` or `master`.
- Finish every change through a pull request and squash-merge it into `origin/main`. Do not merge feature branches into a local default branch.
- After a merge, fetch `origin/main` before creating the next worktree.
