# Stage `is_public` migration fix

## Problem fixed

Stage failed during app migration startup with:

```text
Key column 'is_public' doesn't exist in table
```

The tournament portal migration attempted to create this index:

```sql
CREATE INDEX idx_tournaments_status_public ON tournaments (status, is_public)
```

but existing stage databases can have a `tournaments` table without `is_public`.

## Files changed

Copy these files into the same paths in the application:

- `server/migrations/index.js`
- `migration_scripts/20260427_020_tournament_portals_registrations.sql`

`server/migrations/runner.js` from the prior drop-in patch should remain in place.

## What changed

The migration now checks and adds missing tournament columns before creating the dependent index:

- `tournaments.portal_slug`
- `tournaments.is_public`
- `tournaments.status`

Then it creates:

- `idx_tournaments_portal_slug`
- `idx_tournaments_status_public`

## Deployment

No manual SQL is required.

1. Upload/copy the files into the app.
2. Run the normal deployment command that runs `npm install`.
3. Restart the stage app process if your host does not restart it automatically.

Expected result:

- MySQL pool is created.
- App migrations complete.
- Storage initializes successfully.
- The app no longer starts in degraded mode for the missing `is_public` index dependency.
