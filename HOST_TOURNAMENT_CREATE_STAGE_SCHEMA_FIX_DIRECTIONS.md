# Host Tournament Create Stage Schema Fix

## Root cause

The stage log shows `POST /api/host/tournaments` failed with:

```text
Unknown column 'hra.role_assignment_id' in 'on clause'
```

The host tournament creation flow attempted to resolve a host account through `host_role_accounts.role_assignment_id`. The stage database has an older-compatible `host_role_accounts` schema that does not include that column, so the create transaction failed before inserting the tournament.

## Changed files

```text
server/lib/rbac.js
test/app.test.js
HOST_TOURNAMENT_CREATE_STAGE_SCHEMA_FIX_DIRECTIONS.md
```

## Implementation

`server/lib/rbac.js` now inspects the `host_role_accounts` columns before using `role_assignment_id`.

When the column exists, the current RBAC join behavior is preserved.

When the column does not exist, the host tournament creation path skips the unsupported join and creates or updates the compatible `host_role_accounts` row using only columns present in the deployed schema.

## Deploy directions

1. Copy the changed files into the application root, preserving paths.
2. Run:

```bash
npm test
npm install
```

3. Restart the stage Node process.
4. Sign in as the host and create a tournament from `/host/portal`.
5. Confirm the request succeeds:

```text
POST /api/host/tournaments
```

## Database migration

No migration is required for this patch. This fix is intentionally schema-compatible with both newer and older deployed schemas.
