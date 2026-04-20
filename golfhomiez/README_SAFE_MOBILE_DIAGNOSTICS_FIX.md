# Safe mobile diagnostics fix

This patch removes the recursive preboot logging pattern and replaces it with a safer diagnostics ladder that uses tiny image beacon requests instead of `fetch`, `sendBeacon`, or JSON serialization during page bootstrap.

## Changed files

- `index.html`
- `src/lib/frontend-logger.ts`
- `src/main.tsx`
- `src/App.tsx`
- `server/index.js`
- `server/lib/logger.js`
- `test/app.test.js`

## What changed

### `index.html`
- creates or reuses a lightweight correlation id in `sessionStorage`
- sends only a few bootstrap stage markers to `/diag/pixel.gif`
- does **not** install preboot `error` or `unhandledrejection` handlers
- does **not** use `fetch`, `sendBeacon`, or body serialization

### `src/lib/frontend-logger.ts`
- adds a runtime-only logger that uses image beacons
- limits total sends per page
- deduplicates stage events
- adds guarded runtime listeners for `error` and `unhandledrejection` after the app bundle loads

### `server/index.js`
- adds `GET /diag/pixel.gif`
- logs frontend stages with the correlation id, stage, detail, path, user agent, and referer

### `server/lib/logger.js`
- adds `logging/frontend.log`

## Where to look

Search `logging/frontend.log` by `correlationId`. The typical safe boot trail is:

- `html_script_started`
- `document_interactive`
- `main_tsx_loaded`
- `react_root_created`
- `react_render_requested`
- `app_mounted`
- `route:/...`

If the sequence stops before `main_tsx_loaded`, the issue is likely before the React bundle becomes active.
If it reaches `app_mounted` and then fails, the issue is probably in app logic, routing, auth, or component rendering.

## Apply

Copy the changed files into the same paths in the app, then run:

```bash
npm test
npm run build
```
