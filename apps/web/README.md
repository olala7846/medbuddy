# `@medbuddy/web`

Application shell: authentication, actor resolution, HTTP/route adapters, and composition root for demo and production wiring.

## Public entry

- `.` → browser-safe chat/persona/attachment-input/review helpers
- `./server` → server-only auth, attachment admission, composition (do not import from client bundles)

## Depends on

- `@medbuddy/contracts`
- `@medbuddy/chat`
- `@medbuddy/care-record`
- `@medbuddy/platform`

Does **not** yet depend on `@medbuddy/intelligence` (wire when connecting responder/capture end-to-end).

## Must not

- Become the long-term home of canonical business policy (prefer domain packages)
- Export server-only modules from the browser barrel

## Layout

```text
src/auth/            Session providers and actor resolution
src/composition/     Config, demo workspace, production wiring
src/*.ts             Route adapters and persona/chat helpers
tests/               Workspace-scoped tests
```

Next.js `app/` routes are deferred; this package is currently a composable TypeScript shell.

## Tests

```bash
npm test --workspace @medbuddy/web
```
