# Organizer session schema fix

## Changed application paths

- `server/lib/organizer-auth.js`
- `migration_scripts/20260427_022_fix_organizer_session_token_hash.sql`

## What this fixes

Organizer registration/login failed with:

```text
Unknown column 'token_hash' in 'field list'
```

The `organizer_sessions` table already existed locally without the newer `token_hash` column. `CREATE TABLE IF NOT EXISTS` did not repair the existing table, so the organizer session insert failed.

## Install directions

1. Copy the files from this zip into the same paths in the application.
2. Run the migration against the local database:

```bash
mysql -u <user> -p <database> < migration_scripts/20260427_022_fix_organizer_session_token_hash.sql
```

3. Restart the dev server.
4. Test `/organizer/register` and `/organizer/login`.

## Production deployment

Run the same migration before deploying or restarting the updated server:

```bash
mysql -u <user> -p <production_database> < migration_scripts/20260427_022_fix_organizer_session_token_hash.sql
```

This migration is idempotent and safe to rerun. It creates `organizer_sessions` if missing, adds `token_hash` if missing, backfills existing rows with `SHA2(id, 256)`, and creates the needed indexes if missing.
