# Organizer Auth Isolation Fix

## Changed files and application paths

Copy these files into the same paths in the application:

- `src/App.tsx`
  - Uses a dedicated `OrganizerProtectedRoute` for `/organizer/portal`.
  - Keeps `/login`, `/organizer/login`, and `/host/login` independent so one account type does not satisfy or block another account type.

- `src/context/OrganizerAuthContext.tsx`
  - Replaces the previous role-based organizer auth wrapper with an independent organizer session context.

- `src/lib/organizer-auth.ts`
  - New front-end client for `/api/organizer/session`, `/api/organizer/login`, `/api/organizer/register`, and `/api/organizer/logout`.

- `src/pages/OrganizerLogin.tsx`
  - Logs in through the organizer auth endpoint only and routes successful organizer logins to `/organizer/portal`.

- `src/pages/OrganizerRegister.tsx`
  - Creates organizer accounts through the organizer registration endpoint only instead of creating/signing into a GolfHomiez user account.

- `server/lib/organizer-auth.js`
  - New backend organizer auth/session support using the separate `golfhomiez_organizer_session` cookie and `organizer_sessions` table.

- `server/index.js`
  - Adds organizer session, login, registration, and logout API routes.
  - Protects organizer tournament and organizer portal APIs with organizer auth instead of GolfHomiez user auth.
  - Adds organizer SPA routes to server-side route handling.

- `migration_scripts/20260427_021_separate_organizer_auth.sql`
  - Adds organizer password/session schema required for independent organizer login.

- `test/app.test.js`
  - Adds/updates regression coverage verifying organizer, host, and GolfHomiez user auth stay independent.

## Production migration

Before deploying the app changes, run:

```bash
mysql -u <user> -p <database> < migration_scripts/20260427_021_separate_organizer_auth.sql
```

The migration is idempotent and safe to rerun. It adds:

- `organizer_role_accounts.password_hash`
- `organizer_role_accounts.reset_email`
- `idx_organizer_role_accounts_email_direct`
- `organizer_sessions`

## Local validation

Run:

```bash
npm test
```

Expected result from this patch: `49/49` tests passing.

`npm run build` could not complete in this sandbox because `node_modules/.bin/vite` is not executable in the extracted upload (`vite: Permission denied`). Re-run the build in your local checkout after copying the files. If needed, fix local executable permissions with:

```bash
chmod +x node_modules/.bin/vite
npm run build
```

## Behavioral verification

After migration and restart:

1. Sign into `/login` with a GolfHomiez user account.
2. In the same browser, sign into `/host/login` with a host account.
3. In the same browser, sign into `/organizer/login` with an organizer account, even using the same email/username as the other account types.
4. Verify `/organizer/portal` shows organizer tournament information and does not expose GolfHomiez user-only pages through organizer auth.
5. Verify `/host/portal` still requires host auth and `/profile`, `/golf-logger`, `/teams`, and `/my-golf-scores` still require GolfHomiez user auth.
