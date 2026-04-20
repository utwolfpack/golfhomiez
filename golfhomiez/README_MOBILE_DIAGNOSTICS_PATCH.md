# Mobile blank-screen diagnostics patch

## Files in this patch
- `index.html`
- `server/index.js`
- `server/lib/logger.js`
- `src/App.tsx`
- `src/main.tsx`
- `src/lib/frontend-logger.ts`
- `test/app.test.js`
- `README_MOBILE_DIAGNOSTICS_PATCH.md`

## What this patch adds
- Preboot diagnostics in `index.html` that run before the React bundle starts.
- Static asset failure logging for script, stylesheet, and image load failures.
- `GET /diag/pixel.gif` so you can prove the mobile device reached the server even if the app bundle never boots.
- Safer `POST /api/client-logs` handling that does not require authentication and always returns `204`.
- Front-end boot milestone logging from `src/main.tsx` and `src/App.tsx`.
- Correlation IDs written to response headers and log files so a single failing request can be traced.

## Where to look
### 1. `logging/frontend.log`
This is the main file for the iPhone blank-screen problem.

Search for these events:
- `html_preboot_start`
- `document_readystatechange_preboot`
- `asset_load_failure_preboot`
- `window_error_preboot`
- `unhandled_rejection_preboot`
- `diag_pixel_hit`
- `main_tsx_loaded`
- `react_bootstrap_start`
- `react_root_lookup`
- `app_component_mounted`
- `route_changed`
- `asset_load_failure_runtime`
- `window_error_runtime`
- `unhandled_rejection_runtime`
- `window_load_runtime`

### 2. `logging/access.log`
Use this to confirm that the mobile device requested:
- the page HTML
- `/diag/pixel.gif`
- `/api/client-logs`
- any startup API calls

Search by the same `correlationId` from `frontend.log`.

### 3. `logging/error.log`
Use this if `POST /api/client-logs` itself fails or if the server throws during ingestion.

## How to use it
1. Copy the patched files into the same paths in the app.
2. Deploy the app.
3. Open the site on the iPhone and reproduce the blank screen.
4. Search `logging/frontend.log` for the newest `html_preboot_start` entry from that device.
5. Copy its `correlationId`.
6. Search that same `correlationId` in `logging/access.log` and `logging/error.log`.

## How to read the result
- If you see `diag_pixel_hit` but no `main_tsx_loaded`, the HTML loaded but the app bundle likely failed before startup.
- If you see `asset_load_failure_preboot`, the blank screen is likely caused by a missing or blocked JS or CSS asset.
- If you see `main_tsx_loaded` but not `app_component_mounted`, React startup is failing early.
- If you see `window_error_runtime` or `unhandled_rejection_runtime`, the browser should now be giving you the specific client-side failure needed to fix the issue.
