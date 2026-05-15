# Host Tournament Create Stage Schema Fix

## Root cause

The stage logs show `POST /api/host/tournaments` still returned 500, but the failing SQL changed from the prior missing `role_assignment_id` column to:

```text
Field 'email' doesn't have a default value
```

This happened in `resolveHostTournamentAccountId` while creating/fixing a `host_role_accounts` row for legacy stage schemas. The fallback insert did not include `email`, but the stage table requires it.

## Changed files

```text
server/lib/rbac.js
test/app.test.js
```

## What changed

`server/lib/rbac.js` now:

- Resolves a reusable `hostRoleEmail` from the host account email.
- Falls back to a deterministic local host email when the host account email is unavailable.
- Includes `email` when inserting/updating `host_role_accounts` if that column exists.
- Uses dynamic column lists for both legacy and role-assignment schemas so required columns present in stage are populated.

## Deployment

1. Copy the changed files into the application at the same paths.
2. Run:

```bash
npm install
```

3. Restart the stage Node process.
4. Retry creating a tournament from `/host/portal`.
5. Confirm `POST /api/host/tournaments` returns success instead of 500.

## Migration

No migration is required for this fix. It adapts the application code to the existing stage schema.
