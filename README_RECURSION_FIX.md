# Recursion Fix Patch

This patch updates only:
- `index.html`
- `src/lib/frontend-logger.ts`

## What it fixes

The preboot and runtime diagnostics now include recursion guards so the logger does not trigger itself repeatedly and cause:

- `RangeError: Maximum call stack size exceeded`
- blank screen before React boot completes
- unusable early-browser diagnostics

## Main changes

### `index.html`
- Adds a guarded preboot sender with:
  - `isSending`
  - `isHandlingError`
  - `isHandlingRejection`
  - a per-page send limit
- Avoids serializing full browser event objects
- Logs only primitive diagnostic fields
- Keeps the preboot milestones and asset failure logging
- Adds two console breadcrumbs:
  - `[GH preboot] script start`
  - `[GH preboot] before app bundle`

### `src/lib/frontend-logger.ts`
- Adds a runtime guard so the logger cannot re-enter itself
- Adds a per-page client log cap
- Swallows logger transport and serialization failures
- Keeps compatibility with `attachRequestMetadata`
- Keeps runtime boot milestones and error/rejection logging

## Deploy

Replace the files in these paths:
- `index.html`
- `src/lib/frontend-logger.ts`

Then rebuild and redeploy:

```bash
npm run build
```

## Where to look after deploy

Search `logging/frontend.log` by correlation id.

### Expected early sequence
1. `html_preboot_start`
2. `document_readystatechange_preboot`
3. `main_tsx_loaded`
4. `document_readystatechange_runtime`
5. `window_load_runtime`

### If the page still fails
Look for one of these next events:
- `window_error_preboot`
- `asset_load_failure_preboot`
- `unhandled_rejection_preboot`
- `window_error_runtime`
- `asset_load_failure_runtime`
- `unhandled_rejection_runtime`

If you now get one of those events without the stack overflow, the next error should be the one to fix.
