# Organizer Portal Collation Fix - Safe Migration Update

## Issue
`npm run db:migrate` failed because migration `20260508_031` attempted to alter foreign-keyed organizer account/session key columns. MySQL rejected the change because `tournaments.organizer_account_id` references `organizer_role_accounts.id`.

## Fix
This patch keeps the runtime organizer session lookup collation-safe in `server/lib/organizer-auth.js` by using explicit `COLLATE utf8mb4_general_ci` comparisons, but changes migration `20260508_031` to a non-destructive deployment marker (`SELECT 1`). This avoids changing foreign-keyed key columns while still allowing the migration runner to record the deployment.

## Files to replace
- `server/lib/organizer-auth.js`
- `server/lib/rbac.js`
- `server/migrations/index.js`
- `migration_scripts/20260508_028_host_tournament_creation_schema_alignment.sql`
- `migration_scripts/20260508_029_organizer_invite_schema_alignment.sql`
- `migration_scripts/20260508_030_organizer_registration_schema_alignment.sql`
- `migration_scripts/20260508_031_organizer_session_collation_alignment.sql`
- `test/app.test.js`

## Deploy
Run:

```bash
npm install
```

or:

```bash
npm run db:migrate && npm run build
```

## Verify
- Organizer registration succeeds.
- Organizer login succeeds.
- `/api/organizer/session` returns 200, not a collation or FK error.
