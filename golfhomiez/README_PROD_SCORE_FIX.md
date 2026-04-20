# Production score creation fix

## Problem
Production was failing on `POST /api/scores` with:

- `ER_NO_REFERENCED_ROW_2`
- foreign key `fk_scores_user`
- `scores.created_by_user_id -> users.id`

The app now authenticates with Better Auth, so keeping a hard foreign key from `scores.created_by_user_id` to a legacy `users` table can block new score creation when the auth/user storage changes.

## What changed

1. `migration_scripts/20260327_003_drop_stale_scores_user_fk.sql`
   - Drops the stale `fk_scores_user` foreign key if it exists.
2. `server/migrations/index.js`
   - Registers the new migration.
3. `server/db.js`
   - Runs the app migration runner during startup so production picks up the new schema fix.
4. `test/app.test.js`
   - Adds coverage for the new migration wiring.

## Why this is safe

- The app still records `created_by_user_id` and `created_by_email` on every score.
- The index on `created_by_user_id` remains in place for filtering/reporting.
- Authentication still controls who can create records.
- Removing the stale foreign key avoids coupling score creation to an outdated auth table.

## Deploy steps

### Option 1: let app startup apply it
Deploy the changed files, then restart the app.

### Option 2: run migrations manually first
From the project root:

```bash
node server/run-migrations.js
```

Then restart the app.

## Changed paths

- `server/db.js`
- `server/migrations/index.js`
- `migration_scripts/20260327_003_drop_stale_scores_user_fk.sql`
- `test/app.test.js`
