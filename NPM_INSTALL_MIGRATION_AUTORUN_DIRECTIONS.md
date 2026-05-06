# NPM Install Migration Autorun Directions

## Changed files

- `package.json`
  - Changes `postinstall` to run `npm run db:migrate && npm run build`.
  - Changes `build` to only run the Vite build so migrations are not duplicated.
  - Result: stage/production schema migration is attempted automatically during `npm install`.

- `server/migrations/index.js`
  - Makes migration `20260427_020` self-repairing and idempotent.
  - Reads the actual `tournaments.id` column definition from MySQL and uses that definition for `tournament_registrations.tournament_id`.
  - Automatically creates or repairs `tournament_registrations`, indexes, and the FK without manual SQL.

- `migration_scripts/20260427_020_tournament_portals_registrations.sql`
  - Retains the corrected static SQL definition for environments/tools that inspect migration files directly.

- `test/app.test.js`
  - Adds coverage that the migration keeps `tournament_id` compatible and that `postinstall` runs migrations.

- `test/schema-rollback.test.js`
  - Updates the package lifecycle assertion for the new `postinstall` command.

## Deployment instructions

1. Copy the changed files to the same paths in the application.
2. Deploy as usual.
3. Run:

   ```bash
   npm install
   ```

No manual SQL statements are required.

## Behavior on npm install

`npm install` now runs:

```bash
npm run db:migrate && npm run build
```

`npm run db:migrate` uses the application migration runner. It connects using the existing `.env` database variables, applies Better Auth migrations, then applies app migrations.

The `20260427_020` migration now handles both cases automatically:

- Fresh database: creates `tournament_registrations` with a compatible `tournament_id` column and FK.
- Partially deployed or previously broken database: repairs `tournament_registrations.tournament_id` to match `tournaments.id`, recreates indexes, and recreates the FK.

## Verification

After deployment, confirm the logs show migrations completed and the server starts with `storageReady:true` instead of degraded mode.

Optional command:

```bash
npm run db:migrate
```

This is not required for deployment, but is safe to run because migrations are idempotent.

## Validation performed

```bash
node --check server/migrations/index.js
node --check test/app.test.js
node --check test/schema-rollback.test.js
```
