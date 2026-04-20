# Mobile render diagnosis and fix

## Diagnosis

The uploaded app already had routing and diagnostics code added, but two production issues still stood out:

1. **The SPA shell was served with default static-file caching.** The server used `express.static(distDir)` with no special cache policy for `index.html`. That makes mobile Safari/WebKit much more likely to reuse an older HTML shell after deploys while also reusing cached JS bundles. The earlier `304` asset behavior you saw is consistent with this stale-shell/stale-bundle mismatch pattern.
2. **Correlation ids were not actually shared across preboot and runtime frontend logging.** `index.html` stored `gh_correlation_id` / `__GH_CORRELATION_ID__`, while the runtime logger used `gh.correlationId` / `__GH_CORRELATION_ID`. That broke transaction stitching across preboot, runtime, access, and API logs.
3. **The production build did not explicitly target older Safari/WebKit syntax levels.** Desktop browsers could still render while some mobile WebKit builds choke on newer output or vendor syntax.

## Changes made

### Frontend / mobile rendering
- Set the Vite production build target to `['es2020', 'safari14']` and enabled source maps in `vite.config.ts`.
- Kept the safe image-beacon diagnostics approach.
- Unified frontend correlation id storage and global keys between `index.html` and `src/lib/frontend-logger.ts`.
- Added backward-compatible fallback reads for the old correlation id keys so existing sessions do not lose traceability.

### Server / cache behavior
- Updated static-file serving so:
  - `index.html` is always served with `Cache-Control: no-cache, no-store, must-revalidate`
  - hashed assets under `dist/assets` are served with `Cache-Control: public, max-age=31536000, immutable`
- This keeps the SPA shell fresh after deploys while still allowing efficient immutable asset caching.

### Logging
- Added a dedicated `logging/api.log`.
- Added correlation-id middleware that:
  - reads `X-Correlation-Id` when present
  - falls back to query-string beacon ids
  - generates one when absent
  - writes `X-Correlation-Id` back on responses
- Bound `access.log`, `api.log`, `frontend.log`, and `error.log` with the same correlation id.

## Why this should resolve the mobile blank-screen issue

This change set addresses the most likely mobile-only production failure mode in the uploaded app: **stale SPA shell + cached JS mismatch after deploy**, with weak observability making it hard to verify. The explicit Safari/WebKit build target also reduces the chance of a syntax-compatibility failure on mobile browsers.

## Files changed
- `index.html`
- `src/lib/frontend-logger.ts`
- `server/index.js`
- `server/lib/logger.js`
- `vite.config.ts`
- `test/app.test.js`

## Migration scripts

No database schema change was required for this fix, so **no new migration script was added**.

Existing production migration flow remains:

```bash
node server/run-migrations.js
```

## Deploy steps

1. Replace the changed files in the same paths.
2. Build the frontend:

```bash
npm run build
```

3. Restart the app.
4. Clear mobile Safari site data for `golfhomiez.com` before retesting so the new cache policy can take effect.

## Where to look in logs

Search by the shared correlation id across:
- `logging/access.log`
- `logging/api.log`
- `logging/frontend.log`
- `logging/error.log`

Expected frontend stage trail on a healthy load:
- `html_script_started`
- `document_interactive`
- `main_tsx_loaded`
- `react_root_created`
- `react_render_requested`
- `app_mounted`
