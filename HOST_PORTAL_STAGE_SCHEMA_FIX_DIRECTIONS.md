# Host portal stage schema fix

## Issue diagnosed

The stage host portal failed on `GET /api/host/portal` because the host portal tournament query always joined `user_role_assignments` through `host_role_accounts.role_assignment_id`. The stage `host_role_accounts` schema does not include that column, which caused MySQL to throw `Unknown column 'hra.role_assignment_id' in 'on clause'`.

## Changed files

- `server/index.js`
- `test/app.test.js`

## What changed

- `listHostPortalTournaments` now detects whether `host_role_accounts.role_assignment_id` exists before using it in the join.
- `getHostEditableTournament` uses the same schema-safe join logic so host tournament modification does not fail on stage schemas without `role_assignment_id`.
- When `role_assignment_id` is absent, the join falls back to available `auth_user_id` and/or `email` columns.
- If none of those fallback columns exist, the join safely becomes `ON 1 = 0` rather than referencing a missing column.
- Added a regression test to verify the host portal query is compatible with stage schemas that do not have `host_role_accounts.role_assignment_id`.

## Deployment directions

1. Copy the changed files from this patch into the application at the same paths:
   - `server/index.js`
   - `test/app.test.js`
2. Run tests:
   ```bash
   npm test
   ```
3. Build/deploy normally:
   ```bash
   npm run build
   ```
4. Restart the stage Node process after deployment.
5. Reload `/host/portal` and verify `GET /api/host/portal` returns `200`.

## Migration notes

No database migration is required. This fix makes the application compatible with the existing stage schema.

## Validation performed

- `npm test`: passed 65/65.
- `npm run build`: blocked in this local container because Rollup's optional native package `@rollup/rollup-linux-x64-gnu` is missing from `node_modules`. This is the known npm optional dependency install issue, not a source-code error. Run `npm install` or rebuild dependencies in the target environment before `npm run build`.
