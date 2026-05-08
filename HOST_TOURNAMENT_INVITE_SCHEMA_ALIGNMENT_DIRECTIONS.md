# Host Tournament Invite Schema Alignment Fix

## Issue diagnosed

The stage logs show `POST /api/host/tournaments/:id/invite` failing with:

```text
Unknown column 'ora.role_assignment_id' in 'on clause'
```

The failing query is in `server/lib/organizer-auth.js` inside `getOrganizerAccountByEmailDirect`, which is used by `buildOrganizerInviteDetails` while sending the organizer invite.

## Fix included

Changed files:

```text
server/lib/organizer-auth.js
server/lib/rbac.js
server/migrations/index.js
migration_scripts/20260508_028_host_tournament_creation_schema_alignment.sql
migration_scripts/20260508_029_organizer_invite_schema_alignment.sql
test/app.test.js
HOST_TOURNAMENT_INVITE_SCHEMA_ALIGNMENT_DIRECTIONS.md
```

### Runtime changes

`server/lib/organizer-auth.js` now:

- Adds `role_assignment_id` to `organizer_role_accounts` when missing.
- Adds an index for `organizer_role_accounts.role_assignment_id` when available.
- Detects the actual organizer account columns before querying.
- Uses the role-assignment join only when the column exists.
- Falls back to direct `organizer_role_accounts.email` / `auth_user_id` lookup for older stage schemas.
- Applies the same compatibility handling when loading organizer sessions.

### Migration changes

A new migration is registered:

```text
20260508_029_organizer_invite_schema_alignment
```

It adds:

```sql
ALTER TABLE organizer_role_accounts ADD COLUMN role_assignment_id VARCHAR(64) NULL AFTER id;
CREATE INDEX idx_organizer_role_accounts_role_assignment ON organizer_role_accounts (role_assignment_id);
```

The migration is registered in `server/migrations/index.js`, so it runs automatically during:

```bash
npm install
```

## Deployment steps

1. Copy the changed files into the application paths shown above.
2. Run:

```bash
npm install
```

3. Restart the stage Node process.
4. Verify:
   - Create a host tournament.
   - Send the organizer invite.
   - Confirm `POST /api/host/tournaments/:id/invite` returns success.

## Notes

No port values were hardcoded. The existing `.env` / `PORT` behavior is unchanged.
