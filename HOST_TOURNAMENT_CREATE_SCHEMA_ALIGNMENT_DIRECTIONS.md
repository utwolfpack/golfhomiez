# Host Tournament Create Schema Alignment Fix

## Root cause
Stage moved past the previous host role-account compatibility issue, then failed on tournament creation because the `tournaments` table was missing `created_by_auth_user_id`:

`Unknown column 'created_by_auth_user_id' in 'field list'`

The uploaded failing test file also had an outdated assertion that still expected direct `readAsDataURL` usage even though uploads now use the reusable compression helper.

## Changed files

- `server/lib/rbac.js`
- `server/migrations/index.js`
- `migration_scripts/20260508_028_host_tournament_creation_schema_alignment.sql`
- `test/app.test.js`

## Deployment directions

1. Copy the changed files into the application at the same paths.
2. Run:

```bash
npm install
```

The existing `postinstall` script runs:

```bash
npm run db:migrate && npm run build
```

That will apply migration `20260508_028_host_tournament_creation_schema_alignment` before the application build.

3. Restart the stage Node process.
4. Re-test creating a host tournament from `/host/portal`.

## Schema changes applied by migration

The migration conditionally adds missing tournament columns/indexes used by the deployed host tournament create flow:

- `tournaments.tournament_identifier`
- `tournaments.organizer_email`
- `tournaments.created_by_auth_user_id`
- `tournaments.template_key`
- `tournaments.template_background_image_url`
- `tournaments.template_data`
- `idx_tournaments_identifier`
- `idx_tournaments_template_key`

The migration is idempotent through the app migration runner, so it is safe when columns already exist.
