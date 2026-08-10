# Stage 503 / MySQL Collation Recovery

## Diagnosis from the uploaded stage log

The 503 responses are a startup/database migration failure, not a frontend routing problem.

At `2026-08-10T22:51:57.850Z`, database initialization failed in `server/migrations/runner.js` while a migration was executing:

- MySQL error: `ER_CANT_AGGREGATE_2COLLATIONS` / errno `1267`
- Compared collations: `utf8mb4_general_ci` and `utf8mb4_bin`
- The application then logged `Storage initialization failed; starting in degraded mode` with `storageReady:false`.

When `storageReady` is false, the application `requireStorage` middleware returns HTTP 503 (`Service temporarily unavailable`) for storage-backed API requests. This is why the failure appears throughout the application.

The later log entry also reports:

`Table 'stagegolfhomiez.tournament_team_start_assignments' doesn't exist`

That confirms the migration chain stopped before the team-start-assignment migration completed.

## Root cause

Migration `20260806_067_golfhomiez_tournament_search_records` backfills GolfHomiez tournaments by joining identifiers across older and newer tables. The stage database has identifier columns using both `utf8mb4_general_ci` and `utf8mb4_bin`. MySQL rejects an equality comparison when those collations are combined in the backfill expression.

The next migration, `20260806_069_tournament_team_start_assignments`, also needed to create a foreign-key column that exactly matches the type, character set, and collation of `tournaments.id`. A fixed/default table collation is not safe when an existing environment uses `utf8mb4_bin` for tournament IDs.

## Fix included

1. `20260806_067` uses byte-safe (`BINARY`) comparisons for cross-table identifier joins so it can run against mixed-collation databases.
2. `20260806_069` now reads the metadata for `tournaments.id` and creates/reconciles `tournament_team_start_assignments.tournament_id` with the exact same type, character set, and collation before adding its foreign key.
3. New migration `20260810_071_cross_table_identifier_collation_repair` normalizes the cross-table identifier columns introduced by the recent golf-course/tournament changes:
   - `host_accounts.golf_course_id` -> `golf_courses.id`
   - `host_account_requests.golf_course_id` -> `golf_courses.id`
   - `golf_course_public_pages.golf_course_id` -> `golf_courses.id`
   - `golf_course_public_pages.host_account_id` -> `host_accounts.id`
   - `golf_course_tournaments.golfhomiez_tournament_id` -> `tournaments.id`
   - `tournament_team_start_assignments.tournament_id` -> `tournaments.id`
4. Migration `071` reruns the published GolfHomiez tournament search-record backfill. This repairs a stage database where `067` may have partially added its columns/indexes before failing on the data backfill.
5. Runtime Find Tournaments synchronization/search joins now use collation-safe identifier comparisons as an additional compatibility guard.
6. Migration logging now writes the migration version, name, and filename when a migration starts/fails so future startup failures identify the exact migration instead of only pointing to `runner.js`.

## Stage deployment

Take a stage database backup before deploying.

Extract the changed-file ZIP into the stage application root, preserving paths, then run:

```bash
npm install
```

For stage/production, keep:

```env
REQUIRE_DB_MIGRATIONS=true
```

The existing `postinstall` sequence runs the migrations before the production build.

If dependencies are already installed and you want to test only the database repair first, run:

```bash
npm run db:migrate
```

After migrations complete, restart the existing stage process.

## Expected migration/startup result

The logs should show migration messages for the unapplied versions, including `20260806_069` and `20260810_071`, followed by:

```text
Database initialization complete
Storage backend initialized
```

`Storage backend initialized` should include `storageReady:true`.

The following errors should no longer appear:

```text
ER_CANT_AGGREGATE_2COLLATIONS
Illegal mix of collations
tournament_team_start_assignments doesn't exist
Storage initialization failed; starting in degraded mode
```

## Verification

Check application health:

```bash
curl -i https://stage.golfhomiez.com/api/health
```

Expected status: HTTP 200 with `ok:true`.

Check applied migrations:

```sql
SELECT version, name, filename, execution_mode, applied_at
FROM app_schema_migrations
WHERE version >= '20260806_067'
ORDER BY version;
```

Verify the repaired identifier collations:

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'golf_courses' AND COLUMN_NAME = 'id') OR
    (TABLE_NAME = 'host_accounts' AND COLUMN_NAME IN ('id', 'golf_course_id')) OR
    (TABLE_NAME = 'host_account_requests' AND COLUMN_NAME = 'golf_course_id') OR
    (TABLE_NAME = 'golf_course_public_pages' AND COLUMN_NAME IN ('host_account_id', 'golf_course_id')) OR
    (TABLE_NAME = 'tournaments' AND COLUMN_NAME = 'id') OR
    (TABLE_NAME = 'golf_course_tournaments' AND COLUMN_NAME = 'golfhomiez_tournament_id') OR
    (TABLE_NAME = 'tournament_team_start_assignments' AND COLUMN_NAME = 'tournament_id')
  )
ORDER BY TABLE_NAME, COLUMN_NAME;
```

Verify the missing table now exists:

```sql
SHOW CREATE TABLE tournament_team_start_assignments;
```

Verify published GolfHomiez tournaments were backfilled:

```sql
SELECT golfhomiez_tournament_id, tournament_name, tournament_date, active
FROM golf_course_tournaments
WHERE source_type = 'golfhomiez'
ORDER BY tournament_date, tournament_name;
```

Search the stage logs after restart:

```bash
grep -E "db:migrate|Database initialization|Storage backend initialized|ER_CANT_AGGREGATE_2COLLATIONS|tournament_team_start_assignments" logging/access.log logging/error.log
```

## Validation performed on the change set

- Full application test suite: 232 passed, 0 failed.
- Dependency security tests: 8 passed, 0 failed.
- Changed JavaScript syntax checks: passed.
- A live `npm audit --audit-level=high --omit=dev` could not complete in this sandbox because `registry.npmjs.org` DNS resolution returned `EAI_AGAIN`.
- No dependencies or port handling were changed.
- The Vite production build cannot run from the uploaded Windows-oriented `node_modules` in this Linux sandbox; direct Vite execution confirms the missing Linux Rollup native package. A clean install on stage resolves the platform-specific package through the normal install process.
