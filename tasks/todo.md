# MedBuddy Implementation Checklist

**Status:** Awaiting implementation approval

**Plan:** [`tasks/plan.md`](./plan.md)

## How to Use This Checklist

- Complete tasks in dependency order.
- Do not begin parallel streams until Checkpoint A passes and its commit is merged.
- Use separate `codex/` branches/worktrees for Streams 1–3.
- Each task is intended to touch no more than approximately five files. Split a task before implementation if that limit would be exceeded.
- Verification commands become available as their prerequisite tasks create the relevant package scripts.
- A checked task must also satisfy the Definition of Done in `tasks/plan.md`.

## Phase 0: Serial Contract Gate

### F0 — Amend the TDD

- [ ] **Owner:** Foundation
- **Outcome:** Record authenticated access and the modular-monolith/package design before code begins.
- **Dependencies:** None
- **Acceptance:**
  - TDD no longer describes the deployed browser as unauthenticated.
  - TDD records Google allowlisting, fixed credential accounts, and per-tab reviewer personas.
  - TDD records the package seams and collection ownership.
- **Verify:** `rg -n "Auth.js|X-MedBuddy-Demo-Member|modular monolith|collection ownership" docs/TDD.md`
- **Manual:** Compare the amendment against sections 2, 4, 7, 12, 17, 19, 22, and 24 of the V0 TDD.
- **Files:** `docs/TDD.md`

### F1 — Scaffold the npm workspace

- [ ] **Owner:** Foundation
- **Outcome:** Establish one install/build/test boundary without feature code.
- **Dependencies:** F0
- **Acceptance:**
  - Root metadata defines npm workspaces for `apps/*` and `packages/*`.
  - TypeScript, lint, and Vitest base configuration is shared.
  - One lockfile and ignored secret/build paths are established.
- **Verify:** `npm ci --ignore-scripts && npm run check --if-present`
- **Manual:** Confirm there is no second lockfile and no application behavior.
- **Files:** `package.json`, `package-lock.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`

### F2 — Define core IDs, auth, and error contracts

- [ ] **Owner:** Foundation
- **Outcome:** Freeze identity and failure semantics used by every stream.
- **Dependencies:** F1
- **Acceptance:**
  - Branded account, workspace, member, message, fact, review, and handoff IDs exist.
  - `ActorContext` and authentication-method schemas cover reviewer persona assumption and fixed credential actors.
  - An allowlisted Google prototype reviewer has a persistent mapping to one dedicated fictional demo workspace; explicit reset requires an idempotency key and creates a replacement rather than mutating history.
  - One `ApiError` schema covers validation, authentication, authorization, conflicts, providers, and internal failures.
- **Verify:** `npm test --workspace @medbuddy/contracts -- --run ids auth errors demo-workspace`
- **Files:** `packages/contracts/src/ids.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/demo.ts`, `packages/contracts/src/interfaces.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/src/index.ts`, `packages/contracts/tests/auth.test.ts`, `packages/contracts/tests/demo-workspace.test.ts`

### F3 — Define chat and capture contracts

- [ ] **Owner:** Foundation
- **Outcome:** Freeze the seam between Chat and both intelligence workflows.
- **Dependencies:** F2
- **Acceptance:**
  - Message, cursor, attachment, reaction, and retry schemas exist.
  - Capture job, processing state, proposal, and outcome schemas distinguish empty, uncertain, and technical failure.
  - Public `ChatService`, `ConversationResponder`, and `CaptureProcessor` interfaces compile.
- **Verify:** `npm test --workspace @medbuddy/contracts -- --run chat capture`
- **Files:** `packages/contracts/src/chat.ts`, `packages/contracts/src/capture.ts`, `packages/contracts/src/interfaces.ts`, `packages/contracts/src/index.ts`, `packages/contracts/tests/chat-capture.test.ts`

### F4 — Define care-record and grounding contracts

- [ ] **Owner:** Foundation
- **Outcome:** Freeze canonical fact, review, handoff, and medication shapes.
- **Dependencies:** F2
- **Acceptance:**
  - Atomic fact, provenance, conflict, correction, and review schemas exist.
  - Handoff reference-plus-snapshot/version schemas exist.
  - Medication source cards require sources, retrieval dates, limitations, and immutable snapshot versions.
- **Verify:** `npm test --workspace @medbuddy/contracts -- --run care-record handoff grounding`
- **Files:** `packages/contracts/src/care-record.ts`, `packages/contracts/src/handoff.ts`, `packages/contracts/src/grounding.ts`, `packages/contracts/src/index.ts`, `packages/contracts/tests/care-record.test.ts`

### F5 — Add shared scenario fixtures

- [ ] **Owner:** Foundation
- **Outcome:** Give every stream the same valid and invalid integration examples.
- **Dependencies:** F3, F4
- **Acceptance:**
  - Fixtures cover three participants, timing conflict, readable label, medication-change request, and later dizziness report.
  - Invalid fixtures cover cross-person correction, malformed capture output, and unsupported medication claims.
  - Every fixture parses or fails through the expected contract schema.
- **Verify:** `npm test --workspace @medbuddy/contracts -- --run fixtures`
- **Files:** `packages/contracts/fixtures/golden-scenario.ts`, `packages/contracts/fixtures/invalid-scenarios.ts`, `packages/contracts/tests/fixtures.test.ts`

### F6 — Define Firestore documents and adapter test contracts

- [ ] **Owner:** Foundation
- **Outcome:** Freeze collection ownership without implementing GCP adapters.
- **Dependencies:** F3, F4
- **Acceptance:**
  - Workspace, member, message, fact, review, and handoff document schemas are explicit.
  - Repository and dispatcher behavior suites are reusable by in-memory and emulator adapters.
  - Intelligence has no canonical-write repository interface.
- **Verify:** `npm test --workspace @medbuddy/contracts -- --run persistence`
- **Files:** `packages/contracts/src/persistence.ts`, `packages/contracts/src/interfaces.ts`, `packages/contracts/tests/persistence.test.ts`, `packages/contracts/tests/adapter-contract.ts`

## Checkpoint A — Contract Gate

- [ ] F0–F6 are committed and merged.
- [ ] `npm ci --ignore-scripts`
- [ ] `npm run check`
- [ ] `npm run check:boundaries`
- [ ] `npm test`
- [ ] Shared fixtures and public interfaces receive human review.
- [ ] Streams 1–3 branch from the merged checkpoint.

## Stream 1: Canonical Domain and Platform

### S1.1 — Implement consent and actor authorization

- [ ] **Owner:** Stream 1
- **Dependencies:** Checkpoint A
- **Acceptance:**
  - Approved and blocked workspaces produce deterministic eligibility results.
  - Only owners may share, revoke, or reset.
  - A contributor cannot modify another contributor's claim.
- **Verify:** `npm test --workspace @medbuddy/care-record -- --run authorization`
- **Files:** `packages/care-record/src/authorization.ts`, `packages/care-record/src/index.ts`, `packages/care-record/tests/authorization.test.ts`

### S1.2 — Implement facts, conflicts, and corrections

- [ ] **Owner:** Stream 1
- **Dependencies:** S1.1
- **Acceptance:**
  - Candidate facts remain atomic and retain source/contributor provenance.
  - Conflicting timing claims remain separately attributed.
  - Corrections append a fact with `supersedesFactId` and preserve originals.
- **Verify:** `npm test --workspace @medbuddy/care-record -- --run facts conflicts corrections`
- **Files:** `packages/care-record/src/facts.ts`, `packages/care-record/src/review.ts`, `packages/care-record/src/index.ts`, `packages/care-record/tests/facts.test.ts`, `packages/care-record/tests/review.test.ts`

### S1.3 — Implement immutable handoff assembly

- [ ] **Owner:** Stream 1
- **Dependencies:** S1.2
- **Acceptance:**
  - Handoffs store exact source references and a frozen structured snapshot.
  - v2 links to v1 without modifying v1.
  - Rendering a version reads its snapshot rather than current facts.
- **Verify:** `npm test --workspace @medbuddy/care-record -- --run handoff`
- **Files:** `packages/care-record/src/handoff.ts`, `packages/care-record/src/index.ts`, `packages/care-record/tests/handoff.test.ts`

### S1.4 — Implement in-memory repositories

- [ ] **Owner:** Stream 1
- **Dependencies:** S1.3
- **Acceptance:**
  - Workspace, message, fact, review, and handoff repositories satisfy shared adapter contracts.
  - Transactions are emulated atomically for test-observable behavior.
  - Duplicate writes using the same idempotency key are no-ops.
- **Verify:** `npm test --workspace @medbuddy/platform -- --run in-memory`
- **Files:** `packages/platform/src/in-memory/repositories.ts`, `packages/platform/src/in-memory/transactions.ts`, `packages/platform/src/index.ts`, `packages/platform/tests/in-memory.test.ts`

### S1.5 — Implement Firestore repositories

- [ ] **Owner:** Stream 1
- **Dependencies:** S1.4
- **Acceptance:**
  - Firestore adapters satisfy the same shared repository contract suite.
  - Capture completion and candidate writes are transactional and idempotent.
  - Handoff creation atomically writes a version and current pointer.
- **Verify:** `npm test --workspace @medbuddy/platform -- --run firestore-emulator`
- **Files:** `packages/platform/src/firestore/repositories.ts`, `packages/platform/src/firestore/transactions.ts`, `packages/platform/tests/firestore-emulator.test.ts`

### S1.6 — Implement task and attachment adapters

- [ ] **Owner:** Stream 1
- **Dependencies:** S1.5
- **Acceptance:**
  - Capture dispatch sends only workspace and message IDs.
  - Task callbacks verify the configured service-account identity.
  - Attachments use private workspace/message-scoped object paths and validated metadata.
- **Verify:** `npm test --workspace @medbuddy/platform -- --run cloud-tasks storage`
- **Files:** `packages/platform/src/cloud-tasks/dispatcher.ts`, `packages/platform/src/cloud-tasks/verify.ts`, `packages/platform/src/storage/attachments.ts`, `packages/platform/tests/tasks-storage.test.ts`

## Stream 2: Authenticated Chat App

### S2.1 — Implement authentication adapters

- [ ] **Owner:** Stream 2
- **Dependencies:** Checkpoint A
- **Acceptance:**
  - Google access requires a verified allowlisted email or domain.
  - Seeded credential passwords are verified against hashes and return fixed member IDs.
  - Failure responses do not disclose whether an account exists.
- **Verify:** `npm test --workspace @medbuddy/web -- --run auth`
- **Files:** `apps/web/src/auth/config.ts`, `apps/web/src/auth/providers.ts`, `apps/web/src/auth/allowlist.ts`, `apps/web/src/auth/auth.test.ts`

### S2.2 — Implement effective-actor resolution

- [ ] **Owner:** Stream 2
- **Dependencies:** S2.1
- **Acceptance:**
  - Eligible Google sessions may select seeded members through `X-MedBuddy-Demo-Member`.
  - Credential sessions ignore that header and retain their fixed member.
  - Unauthenticated, unseeded, or cross-workspace selections fail before domain invocation.
- **Verify:** `npm test --workspace @medbuddy/web -- --run actor-resolution`
- **Files:** `apps/web/src/auth/actor.ts`, `apps/web/src/auth/actor.test.ts`, `apps/web/src/auth/index.ts`

### S2.3 — Implement ChatService with fixed adapters

- [x] **Owner:** Stream 2
- **Dependencies:** S2.2
- **Acceptance:**
  - Appending persists the human message before response/capture invocation.
  - Polling returns ordered cursor pages and processing changes.
  - Human and fixed MedBuddy replies share the same message schema.
- **Verify:** `npm test --workspace @medbuddy/chat -- --run chat-service`
- **Files:** `packages/chat/src/chat-service.ts`, `packages/chat/src/ports.ts`, `packages/chat/src/index.ts`, `packages/chat/tests/chat-service.test.ts`

### S2.4 — Implement login and chat timeline

- [ ] **Owner:** Stream 2
- **Dependencies:** S2.3
- **Acceptance:**
  - Google and credential login choices are visible.
  - Authenticated users can view, send, and poll messages.
  - Pending, captured, ignored, manual-review, and failed states are readable.
- **Verify:** `npm test --workspace @medbuddy/web -- --run login chat-timeline`
- **Manual:** Run `npm run dev --workspace @medbuddy/web` in in-memory mode and send a fixed-response message.
- **Files:** `apps/web/app/(auth)/page.tsx`, `apps/web/app/workspace/[workspaceId]/page.tsx`, `apps/web/app/workspace/[workspaceId]/chat.tsx`, `apps/web/app/api/workspaces/[workspaceId]/messages/route.ts`, `apps/web/tests/chat.test.tsx`

### S2.5 — Implement per-tab persona and attachment/retry UI

- [x] **Owner:** Stream 2
- **Dependencies:** S2.4
- **Acceptance:**
  - Google persona choice is stored in `sessionStorage` and sent on workspace requests.
  - Credential users cannot change their effective participant.
  - Allowed attachments and failed capture display their upload/retry controls.
- **Verify:** `npm test --workspace @medbuddy/web -- --run persona attachment retry`
- **Manual:** Open two Google prototype-reviewer tabs with different personas and confirm independent headers.
- **Files:** `apps/web/app/workspace/[workspaceId]/persona.tsx`, `apps/web/app/workspace/[workspaceId]/composer.tsx`, `apps/web/src/auth/request-actor.ts`, `apps/web/tests/persona-attachment.test.tsx`

### S2.6 — Implement review and printable handoff views

- [x] **Owner:** Stream 2
- **Dependencies:** S2.5
- **Acceptance:**
  - Batch review exposes attribution, provenance, conflicts, and statuses.
  - Review actions are limited by the supplied actor capabilities.
  - The selected immutable handoff version has a browser-print layout.
- **Verify:** `npm test --workspace @medbuddy/web -- --run review handoff`
- **Manual:** Render fixture v1 and v2, print v1, and verify its displayed snapshot is unchanged.
- **Files:** `apps/web/app/workspace/[workspaceId]/review/page.tsx`, `apps/web/app/workspace/[workspaceId]/review/review-list.tsx`, `apps/web/app/workspace/[workspaceId]/handoff/[version]/page.tsx`, `apps/web/app/workspace/[workspaceId]/handoff/print.css`, `apps/web/tests/review-handoff.test.tsx`

## Stream 3: Intelligence Pipelines

### S3.1 — Implement deterministic safety routing

- [ ] **Owner:** Stream 3
- **Dependencies:** Checkpoint A
- **Acceptance:**
  - Start, stop, continue, change, skip, and dose questions bypass free-form answers.
  - The response refuses the decision and proposes an attributed professional follow-up.
  - No tool can mutate medication or canonical facts.
- **Verify:** `npm test --workspace @medbuddy/intelligence -- --run safety`
- **Files:** `packages/intelligence/src/safety/route.ts`, `packages/intelligence/src/safety/templates.ts`, `packages/intelligence/tests/safety.test.ts`

### S3.2 — Implement medication source-card lookup

- [ ] **Owner:** Stream 3
- **Dependencies:** S3.1
- **Acceptance:**
  - Lookup returns only committed targeted cards.
  - Cards retain source, retrieval date, snapshot version, and limitations.
  - Unsupported medicines return no identity or safety inference.
- **Verify:** `npm test --workspace @medbuddy/intelligence -- --run grounding`
- **Files:** `packages/intelligence/src/grounding/lookup.ts`, `packages/intelligence/src/grounding/render.ts`, `packages/intelligence/tests/grounding.test.ts`, `fixtures/medication/source-cards.json`

### S3.3 — Implement conversational responder

- [ ] **Owner:** Stream 3
- **Dependencies:** S3.1, S3.2
- **Acceptance:**
  - `@MedBuddy` messages receive friendly responses through `ConversationResponder`.
  - Medication claims are limited to returned source-card content.
  - Provider and schema failures return typed retryable results.
- **Verify:** `npm test --workspace @medbuddy/intelligence -- --run conversation`
- **Files:** `packages/intelligence/src/conversation/responder.ts`, `packages/intelligence/src/conversation/tools.ts`, `packages/intelligence/src/index.ts`, `packages/intelligence/tests/conversation.test.ts`

### S3.4 — Implement text capture processor

- [ ] **Owner:** Stream 3
- **Dependencies:** S3.3
- **Acceptance:**
  - Extraction returns atomic focal-message proposals with fixed contributor/source IDs.
  - Passive empty, explicit empty, uncertain, and technical failure remain distinct.
  - Nearby context cannot become a fact source in the focal run.
- **Verify:** `npm test --workspace @medbuddy/intelligence -- --run capture-text`
- **Files:** `packages/intelligence/src/capture/processor.ts`, `packages/intelligence/src/capture/prompt.ts`, `packages/intelligence/src/capture/validate.ts`, `packages/intelligence/tests/capture-text.test.ts`

### S3.5 — Add readable-label image capture

- [ ] **Owner:** Stream 3
- **Dependencies:** S3.4
- **Acceptance:**
  - Printed Traditional Chinese, English, and numeric label fixtures produce typed proposals.
  - Unreadable or handwriting fixtures remain unresolved.
  - Pill appearance alone never establishes identity.
- **Verify:** `npm test --workspace @medbuddy/intelligence -- --run capture-image`
- **Files:** `packages/intelligence/src/capture/image.ts`, `packages/intelligence/tests/capture-image.test.ts`, `packages/intelligence/tests/fixtures/readable-label.png`, `packages/intelligence/tests/fixtures/unreadable-label.png`

### S3.6 — Add injection and model-adapter tests

- [ ] **Owner:** Stream 3
- **Dependencies:** S3.5
- **Acceptance:**
  - Fixed model adapters cover success, empty, malformed, timeout, and provider failure.
  - Chat/image injection fixtures cannot change policies or tool permissions.
  - Vertex responses are schema-validated before entering module logic.
- **Verify:** `npm test --workspace @medbuddy/intelligence -- --run model-adapter injection`
- **Files:** `packages/intelligence/src/adapters/fixed-model.ts`, `packages/intelligence/src/adapters/vertex.ts`, `packages/intelligence/tests/model-adapter.test.ts`, `packages/intelligence/tests/injection.test.ts`

## Checkpoint B — Independent Workstreams

- [ ] Stream 1 domain and in-memory suites pass without Next.js or Gemini.
- [ ] Stream 2 browser flow passes in in-memory/fixed-adapter mode.
- [ ] Stream 3 pipeline suite passes without browser or Firestore.
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run check:boundaries` proves no stream imports another stream's internal files or violates the approved dependency direction.

## Phase 2: Cross-module Integration

### I1 — Wire in-memory golden path

- [ ] **Owner:** Integration/Stream 1
- **Dependencies:** Checkpoint B
- **Acceptance:**
  - A persisted message dispatches capture and stores validated candidate facts.
  - Successful storage exposes one delayed `👀`; empty/failed paths expose none.
  - Review produces immutable handoff v1.
- **Verify:** `npm test -- --runInBand tests/integration/golden-path.test.ts`
- **Files:** `apps/web/src/composition/in-memory.ts`, `tests/integration/golden-path.test.ts`, `tests/integration/test-app.ts`

### I2 — Integrate conversation and failure retry

- [ ] **Owner:** Integration/Stream 1
- **Dependencies:** I1
- **Acceptance:**
  - `@MedBuddy` uses the production responder interface and appends one MedBuddy message.
  - Conversation failure preserves the human message and exposes retry.
  - Capture performs three technical attempts before manual retry is enabled.
- **Verify:** `npm test -- --runInBand tests/integration/conversation-retry.test.ts`
- **Files:** `apps/web/src/composition/in-memory.ts`, `tests/integration/conversation-retry.test.ts`, `tests/integration/test-app.ts`

### I3 — Integrate handoff v2

- [ ] **Owner:** Integration/Stream 1
- **Dependencies:** I2
- **Acceptance:**
  - The later dizziness report adds an attributed, non-causal fact.
  - v2 links to v1.
  - Reopening v1 produces its original snapshot.
- **Verify:** `npm test -- --runInBand tests/integration/handoff-versioning.test.ts`
- **Files:** `tests/integration/handoff-versioning.test.ts`, `tests/integration/test-app.ts`

## Checkpoint C — Cross-module

- [ ] `npm run check`
- [ ] `npm run check:boundaries`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Golden path passes without live cloud dependencies.
- [ ] Contract and integration changes receive human review.

## Phase 3: Production Adapters and Deployment

### P1 — Compose Firestore, Tasks, Storage, and Vertex

- [ ] **Owner:** Stream 1
- **Dependencies:** Checkpoint C, S1.6, S3.6
- **Acceptance:**
  - Production composition satisfies the same module interfaces as in-memory mode.
  - Required environment configuration fails clearly at startup.
  - Internal task route accepts only verified task identity and canonical IDs.
- **Verify:** `npm test -- --runInBand tests/integration/production-composition.test.ts`
- **Files:** `apps/web/src/composition/production.ts`, `apps/web/app/api/internal/capture/route.ts`, `apps/web/src/composition/config.ts`, `tests/integration/production-composition.test.ts`

### P2 — Add seed and targeted medication scripts

- [ ] **Owner:** Stream 1 with Stream 3 review
- **Dependencies:** P1
- **Acceptance:**
  - Seed creates one approved fictional workspace and three mapped participants idempotently.
  - Medication script downloads/parses official CSV without an LLM and commits only targeted cards.
  - Neither script emits credentials, raw health data, or the full source dataset.
- **Verify:** `npm test -- --runInBand scripts && npm run medication:snapshot -- --dry-run`
- **Files:** `scripts/seed-demo.ts`, `scripts/build-medication-snapshot.ts`, `scripts/scripts.test.ts`, `fixtures/scenarios/golden.json`

### P3 — Document and execute GCP setup

- [ ] **Owner:** Stream 1
- **Dependencies:** P2
- **Acceptance:**
  - Setup notes name required APIs, region, identities, IAM roles, queue, bucket, secrets, and OAuth redirect URIs.
  - One Cloud Run service is deployed without committing credentials.
  - Deployment URL reaches authenticated login.
- **Verify:** `gcloud run services describe medbuddy --project med-buddy --region "$MEDBUDDY_GCP_REGION" --format='value(status.url)'`
- **Manual:** Open the returned URL and complete one allowlisted login.
- **Files:** `infra/README.md`, `README.md`

### P4 — Run external-service smoke tests

- [ ] **Owner:** Integration
- **Dependencies:** P3
- **Acceptance:**
  - One Firestore transaction, Storage round trip, task callback, Vertex text call, and Vertex image call succeed.
  - Test artifacts are fictional and removed or reset afterward.
  - Failures expose sanitized codes without raw content.
- **Verify:** `npm run test:smoke`
- **Files:** `tests/integration/gcp-smoke.test.ts`, `tests/integration/vertex-smoke.test.ts`, `package.json`

## Checkpoint D — External Adapters

- [ ] Emulator and live smoke suites pass.
- [ ] No secret, PII, health-data, or raw-trace material is staged.
- [ ] `npm audit` findings are reviewed for reachability; no forced remediation is used.
- [ ] Deployment and local commands are exact and reviewer-accessible.

## Phase 4: Browser Acceptance and Stabilization

### E1 — Automate authenticated three-tab scenario

- [ ] **Owner:** Stream 2
- **Dependencies:** Checkpoint D
- **Acceptance:**
  - Three credential accounts operate as fixed owner/caregiver participants.
  - Conflict, refusal, review, v1, later event, and v2 complete through the browser.
  - Reopened v1 remains unchanged.
- **Verify:** `npm run test:e2e -- --grep "golden path"`
- **Files:** `tests/e2e/golden-path.spec.ts`, `tests/e2e/helpers/auth.ts`, `tests/e2e/helpers/scenario.ts`

### E2 — Verify Google persona switching and failure UI

- [ ] **Owner:** Stream 2
- **Dependencies:** E1
- **Acceptance:**
  - Two Google prototype-reviewer tabs maintain independent seeded personas.
  - Provider and capture failures show the correct retry actions.
  - Critical status and safety text remains readable at mobile width.
- **Verify:** `npm run test:e2e -- --grep "reviewer personas|failure retry"`
- **Files:** `tests/e2e/reviewer-personas.spec.ts`, `tests/e2e/failure-retry.spec.ts`

### E3 — Final repository and runtime verification

- [ ] **Owner:** Integration
- **Dependencies:** E2
- **Acceptance:**
  - Exact install, check, test, build, and run commands succeed from a clean checkout.
  - README identifies shipped, cut, reused, AI-produced, rewritten, and manually verified work.
  - Public repository scan finds no secrets, PII, or real health information.
- **Verify:** `npm ci --ignore-scripts && npm run check && npm test && npm run build && npm run test:e2e`
- **Manual:** Complete the deployed golden path and browser print with audio disabled.
- **Files:** `README.md`, `docs/TDD.md`, `tasks/todo.md`

## Checkpoint E — Ready for Review

- [ ] All required tasks and checkpoints are complete.
- [ ] Full Definition of Done passes.
- [ ] Deployed golden path succeeds.
- [ ] v1/v2 immutability is demonstrated.
- [ ] Known limitations and deferred scope are visible.
- [ ] Human approves before merge or submission.
