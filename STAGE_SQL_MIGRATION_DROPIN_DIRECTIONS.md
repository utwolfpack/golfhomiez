# Stage SQL Migration Drop-in Patch

## Files included

Copy these files into the application root, preserving paths:

- `server/migrations/runner.js`
- `server/migrations/index.js`
- `migration_scripts/20260427_020_tournament_portals_registrations.sql`

## What this fixes

The stage error was caused by generated migration SQL containing:

```sql
UNDEFINED NOT NULL
```

That happened while building the `tournament_registrations.tournament_id` column definition from `information_schema`. The patched migration definition now explicitly aliases MySQL metadata columns:

```sql
COLUMN_TYPE AS column_type,
CHARACTER_SET_NAME AS character_set_name,
COLLATION_NAME AS collation_name
```

This prevents Node/MySQL result-key casing differences from producing `undefined` values in JavaScript.

The patched runner also fails fast before executing migration SQL if a migration ever produces unsafe SQL containing `UNDEFINED`.

## Deployment steps

1. Stop the stage Node process currently holding port `5002`.
2. Copy the included files into the application root.
3. Run:

```bash
npm install
```

The existing install hook will run migrations automatically. No manual SQL is required.

4. Start the application normally.

## Verification

After startup, confirm the logs do not include either of these messages:

- `UNDEFINED NOT NULL`
- `Storage initialization failed; starting in degraded mode`

The app should start with storage initialized and API routes should stop returning 503.
