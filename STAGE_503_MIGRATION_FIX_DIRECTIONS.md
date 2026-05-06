# Stage 503 migration fix

## Diagnosis

The uploaded logs show the service starts in degraded mode because database initialization fails before storage is ready. The failing migration creates `tournament_registrations.tournament_id` as `VARCHAR(64)` while `tournaments.id` is `VARCHAR(191)`. MySQL requires foreign-key columns to have compatible definitions, so it rejects `fk_tournament_registrations_tournament` with `ER_FK_INCOMPATIBLE_COLUMNS`.

Because storage initialization fails, routes protected by `requireStorage` return HTTP 503, including `/api/profile` and `/api/organizer/session`.

## Changed files

- `migration_scripts/20260427_020_tournament_portals_registrations.sql`
  - Changes `tournament_registrations.tournament_id` from `VARCHAR(64)` to `VARCHAR(191)` so it matches `tournaments.id` and the foreign key can be created.
- `test/app.test.js`
  - Adds coverage that verifies the migration keeps `tournament_id` compatible with `tournaments.id` and still declares the tournament foreign key.

## Deploy directions

1. Copy the changed files into the application at the same paths listed above.
2. Deploy/restart the app normally so the migration runner can re-attempt migration `20260427_020`.
3. Verify startup logs show `storageReady:true` or no `Storage initialization failed; starting in degraded mode` entry.
4. Verify `/api/profile` no longer returns 503 after login.

## If the failed migration left a partial table behind

The MySQL `CREATE TABLE` with the invalid foreign key normally fails atomically, so the table usually will not exist. If a partial `tournament_registrations` table was manually created or exists without the FK, run this before restarting:

```sql
ALTER TABLE tournament_registrations MODIFY tournament_id VARCHAR(191) NOT NULL;
```

Then restart the app. If the migration version `20260427_020` was incorrectly marked as applied despite the failure, remove only that migration marker and restart so it can run again:

```sql
DELETE FROM app_schema_migrations WHERE version = '20260427_020';
```

Do not run the delete unless the schema is missing `tournament_registrations`, `portal_slug`, or the expected indexes/foreign key.

## Validation

Run:

```bash
node --test test/app.test.js
```

In this extracted environment the full test suite still depends on installed npm packages, so run the command after `npm install` in the deployed application checkout.
