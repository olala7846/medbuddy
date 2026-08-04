# ADR-0001: Prioritize a Live Telegram Family Alpha

## Status

Superseded by ADR-0002 on 2026-08-03

## Date

2026-07-31

## Context

The repository has a strong modular foundation, deterministic domain and safety tests, cloud adapters, and a runnable fake-backed web application. The web application demonstrates interface states, but it does not connect ordinary conversation to the real intelligence pipeline, reviewed facts, and useful summaries. Continued presentation work would improve the appearance of the prototype without validating whether MedBuddy helps a family coordinate care.

The original AI Fund deadline has passed. Submission polish is no longer the primary constraint. The product now needs to provide repeated value to its builder and family in the communication surface they actually use.

The first real use case is two adults coordinating appointments and observations for a dependent child in a private group chat. This exposes a domain mismatch: the existing model assumes the health-information owner is an adult chat participant and excludes guardianship.

## Decision

Prioritize a live Telegram family alpha over further fake-web-demo polish.

- Telegram is the first external channel.
- The existing modular monolith and GCP foundation remain in place.
- A dependent care subject is modeled separately from the adult technical steward and contributors.
- The first vertical milestone is Telegram message -> candidate fact -> review -> source-linked pre-visit brief.
- Images, after-visit documents, and richer conversation follow only after that path is safe and useful.
- Real family data is admitted only after explicit consent, membership blocking, retention, deletion, secret handling, log redaction, and deployed fictional-data verification pass.
- The web demo remains a test harness and reference implementation; it is not the product priority.

## Alternatives Considered

### Continue polishing the web prototype

- Benefit: lowest implementation effort and easiest reviewer presentation.
- Cost: does not test behavior inside a real family conversation and preserves the current integration gap.
- Rejected because it optimizes presentation instead of product value.

### Build a dedicated MedBuddy application

- Benefit: full control over privacy, interaction, and review UI.
- Cost: creates onboarding and usage friction before the core workflow is validated.
- Deferred until the group-chat workflow demonstrates repeat value.

### Start with LINE

- Benefit: strategically relevant to the earlier Taiwan market hypothesis.
- Cost: slower initial integration and less convenient for the immediate family alpha.
- Deferred; channel-neutral contracts should keep later LINE integration possible.

### Start with Telegram

- Benefit: straightforward bot API, webhooks, group participation, media, commands, reactions, and inline review controls.
- Cost: group chats are Telegram cloud chats, passive access requires clear disclosure, and the bot becomes responsible for sensitive third-party processing.
- Selected because it provides the shortest path to testing actual family value.

## Consequences

- Product documentation and execution tasks must use the family-alpha goal as the source of priority.
- The AI Fund challenge remains historical context; its medical-safety constraints remain binding.
- The care-record contracts require a small but meaningful subject/steward migration.
- Privacy posture changes from fictional-only runtime to private, consented real-data processing; repository and telemetry hygiene become stricter.
- Infrastructure work is justified only when it enables the live vertical path.
- Success is measured by repeated family usefulness, not reviewer impressions or web visual polish.
- If the family does not choose to keep using the bot after ordinary use, the team should revisit the workflow before adding channels or infrastructure.
