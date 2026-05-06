# Tournament Schema Stage Compatibility Fix

## Files included

- `server/index.js`
- `server/migrations/index.js`
- `migration_scripts/20260506_021_tournament_schema_stage_compat.sql`

## What this fixes

The stage error:

```text
Unknown column 'ora.organization_name' in 'field list'
```

was caused by tournament queries assuming every environment has `organizer_role_accounts.organization_name`. Stage has an older/partial organizer schema.

This patch fixes that in two ways:

1. Adds migration `20260506_021` to reconcile tournament-related schema differences without manual SQL.
2. Updates tournament queries to dynamically use whichever compatible organizer/host columns exist, instead of hardcoding `ora.organization_name`.

## Schema reconciliation added

The new migration ensures these tournament support fields exist when missing:

### `tournaments`

- `tournament_identifier`
- `portal_slug`
- `name`
- `title`
- `description`
- `start_date`
- `end_date`
- `status`
- `is_public`
- `host_account_id`
- `organizer_account_id`
- `organizer_email`
- `created_at`
- `updated_at`

### `organizer_role_accounts`

- `organization_name`

Backfilled from `organizer_name`, `contact_name`, or `email` when available.

### `host_role_accounts`

- `golf_course_name`

Backfilled from `account_name` or `course_name` when available.

### `host_accounts`

- `golf_course_name`

Backfilled from `account_name` or `course_name` when available.

### Indexes

- `idx_tournaments_identifier`
- `idx_tournaments_portal_slug`
- `idx_tournaments_status_public`
- `idx_tournaments_host_account`
- `idx_tournaments_organizer_account`

## Deployment

Copy the files from this zip into the same paths in the application, replacing existing files.

Then run your existing deployment command. Since migrations are wired to run during `npm install`, no manual SQL is required.

```bash
npm install
```

Then restart the Node service if your hosting platform does not restart it automatically.

## Verification

After deploy, confirm the logs show:

```text
[db:migrate] 20260506_021 executed
Database initialization complete
MySQL storage initialized
Storage backend initialized
Server listening
```

Then load:

- `/my-tournaments`
- `/host/portal`
- `/organizer/portal`

The routes should no longer fail on missing `organization_name`, and tournament metadata/registration counts should still load.
