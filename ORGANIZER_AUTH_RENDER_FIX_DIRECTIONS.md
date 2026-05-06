# Organizer auth render/startup fix

## Files changed

- `server/lib/organizer-auth.js`
- `test/app.test.js`

## What this fixes

The dev server was crashing while Vite stayed running, which prevented the application from rendering correctly. The organizer auth module now avoids a static circular dependency with RBAC helpers during server startup and keeps the organizer session `token_hash` compatibility/backfill logic in the runtime schema check.

## Install directions

Copy the files from this zip into the same paths in the application root:

- `server/lib/organizer-auth.js` -> `<app root>/server/lib/organizer-auth.js`
- `test/app.test.js` -> `<app root>/test/app.test.js`

Then restart the dev server:

```bash
npm run dev
```

## Migration directions

No new migration is required for this patch. Keep and run the prior organizer session migration if it has not already been applied:

```bash
mysql -u <user> -p <database> < migration_scripts/20260427_022_fix_organizer_session_token_hash.sql
```

## Verification

Run:

```bash
npm test
npm run dev
```

Expected behavior:

- Node server starts without nodemon reporting `app crashed`.
- Vite starts normally.
- The app renders.
- `/organizer/login` remains separate from `/login` and `/host/login`.
