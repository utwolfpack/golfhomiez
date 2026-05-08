# Tournament delete changes

## Changed application paths

- `server/index.js`
  - Adds `DELETE /api/host/tournaments/:id` for host-owned tournament deletion.
  - Adds `DELETE /api/organizer/tournaments/:id` for organizer-invited tournament deletion.
  - Logs delete requests, not-found outcomes, completed deletions, and errors with the existing request correlation id.

- `server/lib/tournament-delete.js`
  - Runs tournament deletion in a single database transaction.
  - Deletes tournament-owned records that are safe to remove before deleting the tournament:
    - `tournament_registrations`
    - `organizer_tournament_invites`
  - Keeps shared records intact:
    - teams and team members
    - app users/auth users
    - host accounts
    - organizer accounts
    - log files

- `src/lib/accounts.ts`
  - Adds typed client helpers:
    - `deleteHostTournamentRecord(tournamentId)`
    - `deleteOrganizerTournamentRecord(tournamentId)`

- `src/pages/HostPortal.tsx`
  - Adds host tournament delete buttons and confirmation prompts.
  - Removes deleted tournaments from the host portal list without a full page refresh.
  - Adds front-end transaction/error logging for delete actions.

- `src/pages/OrganizerTournaments.tsx`
  - Adds organizer tournament delete buttons and confirmation prompts.
  - Removes deleted tournaments from the organizer portal list without a full page refresh.
  - Adds front-end transaction/error logging for delete actions.

- `test/app.test.js`
  - Adds coverage for the safe-delete transaction helper, API routes, UI buttons, client helpers, and logging markers.

## Logging

Tournament deletes use the existing logging system and correlation id propagation.

Search the same correlation id across:

- `logging/access.log`
- `logging/api.log`
- `logging/error.log`
- `logging/frontend.log`

Important delete log markers:

- `host_tournament_delete_requested`
- `host_tournament_deleted`
- `host_tournament_delete_failed`
- `organizer_tournament_delete_requested`
- `organizer_tournament_deleted`
- `tournament_delete_requested`
- `tournament_deleted`
- `tournament_delete_failed`

## Migration scripts

No schema migration is required for this change. The delete functionality uses the existing schema and removes existing tournament-owned child rows in application code before removing the tournament row.

The existing install migration process remains unchanged and already runs during npm install:

```bash
npm install
```

That runs:

```bash
npm run db:migrate && npm run build
```

For production deployment, keep the existing deployment process:

```bash
npm install
npm test
npm run build
npm start
```

If production requires migrations to fail closed instead of skipping when the database is unavailable, set:

```bash
REQUIRE_DB_MIGRATIONS=true
```

## Verification

Run:

```bash
npm test
npm run build
```

Manual verification:

1. Log in as a host.
2. Open the host portal.
3. Click **Delete tournament** on a tournament.
4. Confirm the prompt.
5. Verify the tournament disappears from the host list.
6. Search the correlation id in `access.log`, `api.log`, and `frontend.log`.
7. Repeat from the organizer portal for an invited tournament.
