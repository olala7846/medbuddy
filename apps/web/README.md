# `@medbuddy/web`

Application shell and runnable local browser host: authentication, actor resolution, HTTP route adapters, and composition roots for demo and production wiring.

## LINE webhook

`POST /api/line/webhook` is the server-only LINE Messaging API boundary. It verifies the exact bounded raw body before parsing, maps one DM/group/room to an opaque workspace, persists supported events into the continuity ledger, and uses the event reply token once. Group and legacy-room messages are always observed; LINE's explicit self-mention marker controls only whether MedBuddy replies.

`POST /api/internal/continuity` and `POST /api/internal/attachment` are
OIDC-authenticated Cloud Tasks boundaries. They compact bounded conversation
history and ingest validated LINE image/PDF bytes into private Cloud Storage;
neither accepts public browser traffic.

Run the credential-free signed synthetic path with:

```bash
npm run smoke:line
```

Live configuration and the fictional-only rollout checkpoint are documented in [`../../docs/LINE_SETUP.md`](../../docs/LINE_SETUP.md).

## Run the fictional local demo

From the repository root:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. No environment file, cloud service, identity provider, credential, or deployment is required. The local host accepts fictional data only. Sessions and all workspace changes are held in process memory and reset when the dev server restarts.

The sign-in screen offers two deliberately fake paths:

- **Prototype reviewer**: a server-created, verified allowlisted reviewer. Choose a fictional member in each browser tab; the selection stays in that tab's `sessionStorage`.
- **Fixed fictional participant**: username `fictional-owner`, password `fictional-password`. This account is fixed to `member:owner` and ignores reviewer-persona headers.

The credential is public test data, is not a secret, and must never be reused outside this local fixture.

## Manual verification

1. Enter the prototype reviewer demo and select `member:owner`.
2. In a second tab, select `member:caregiver-a`; confirm the first tab remains the owner.
3. Send `@MedBuddy I felt fictional mild dizziness after breakfast.` Confirm the message and fixed safe reply remain after refresh, then watch the textual status progress to **Captured**.
4. Attach a small, fictional JPEG, PNG, or WebP (maximum 5 MiB) and send another message. The browser sends raw bytes to the local route; admission and storage stay server-side.
5. Send `[demo:fail-once] Fictional capture retry check.` Wait for **Failed**, choose **Retry capture**, and confirm **Captured**. Optional controls are `[demo:ignore]` and `[demo:manual-review]`.
6. Open **Review facts**. Inspect contributor attribution, source provenance, statuses, the conflicting timing report, uncertainty, follow-up, and limitations.
7. Open handoff v1 and print it; confirm the later mild-dizziness fixture is absent. Open v2 and confirm it is present, then revisit v1 to confirm it remains frozen.
8. Log out and use the fixed fictional credentials. Confirm there is no persona selector.
9. Repeat the main path in a narrow viewport using only the keyboard. Confirm states remain understandable without color.

The demo markers control only the deterministic local dispatcher. They are not production commands or authority.

## Browser smoke coverage

```bash
npm exec playwright install chromium
npm run test:e2e
```

Playwright starts a fresh dev process on `http://localhost:3100`, uses one Chromium worker and a mobile-sized viewport, and checks the reviewer and credential paths, polling, attachment admission, retry, review, immutable handoffs, print invocation, logout, browser-console errors, and unexpected non-localhost traffic.

Read-only review and printing of stored handoff v1/v2 are in scope. Review mutations, creation of new handoffs, workspace reset UI, production authentication, cloud persistence, background durability, WebSockets, deployment, and cross-browser certification remain deferred.

### Dependency audit note (2026-08-03)

`npm audit --omit=dev` reports 9 findings (5 moderate, 4 high, 0 critical). The high findings are transitive paths through Firestore's CLI cleanup dependencies and Next.js's PostCSS build and optional Sharp image dependencies. The application does not invoke those cleanup paths, process user-authored CSS, or use `next/image`. Private LINE attachment ingestion does use `@google-cloud/storage`, but the reported moderate chain concerns UUID buffer APIs and retry machinery that this adapter does not call directly; the audit-suggested remediation is an incompatible major downgrade. These findings remain deployment debt, not a claim that Storage is outside the LINE composition. Recheck and upgrade compatible dependencies before enabling real family data.

## Public entry

- `.` → browser-safe chat/persona/attachment-input/review helpers
- `./server` → server-only auth, attachment admission, composition (do not import from client bundles)

## Depends on

- `@medbuddy/contracts`
- `@medbuddy/chat`
- `@medbuddy/care-record`
- `@medbuddy/intelligence`
- `@medbuddy/platform`

## Must not

- Become the long-term home of canonical business policy (prefer domain packages)
- Export server-only modules from the browser barrel

## Layout

```text
src/auth/            Session providers and actor resolution
src/composition/     Config, demo workspace, production and LINE wiring
src/line/            LINE signature, identity, reply, HTTP, runtime, and webhook adapters
src/local-demo/      Process-local sessions, deterministic dispatcher, HTTP helpers
src/*.ts             Route adapters and persona/chat helpers
app/                 Next.js pages and localhost-only route handlers
e2e/                 Playwright Chromium smoke flow
tests/               Workspace-scoped tests
```

## Tests

```bash
npm test --workspace @medbuddy/web
npm run build --workspace @medbuddy/web
```
