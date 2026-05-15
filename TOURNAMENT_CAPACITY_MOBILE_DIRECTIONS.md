# Tournament capacity, mobile tournament pages, migrations, and logging directions

## Changed application paths

- `server/index.js`
  - Adds tournament capacity calculations for public portal, host portal, and organizer portal reads.
  - Blocks tournament registration when `openTeamSlotCount` is zero.
  - Logs tournament portal loads, full-slot registration attempts, registrations, and host/organizer updates with capacity fields on the shared request correlation id.

- `server/lib/rbac.js`
  - Adds `teamSlotLimit` sanitizing and defaulting to 24.
  - Persists `tournaments.team_slot_limit` during host-created, organizer-created, and host-managed tournament creation.
  - Maps `teamSlotLimit` on returned tournament objects.

- `server/migrations/index.js`
  - Registers migration `20260513_033_tournament_team_slot_limit` with idempotent checks.

- `migration_scripts/20260513_033_tournament_team_slot_limit.sql`
  - Adds `tournaments.team_slot_limit INT NOT NULL DEFAULT 24` and backfills existing tournament rows.

- `src/lib/accounts.ts`
  - Adds shared TypeScript fields for `teamSlotLimit`, `registeredTeamCount`, `verifiedUserCount`, and `openTeamSlotCount`.

- `src/pages/HostPortal.tsx`
  - Adds the number field labeled `Number of teams to play in the tournament`, defaulting to 24, on tournament creation and edit forms.
  - Shows teams registered, verified users, and open team slots on host tournament tiles/details.
  - Logs host create/update transactions with tournament capacity data.

- `src/pages/OrganizerTournaments.tsx`
  - Adds the tournament team-count edit field for invited organizer-managed tournaments.
  - Shows teams registered, verified users, and open team slots on organizer tournament tiles/details.
  - Logs organizer update transactions with tournament capacity data.

- `src/pages/TournamentPortal.tsx`
  - Shows teams registered, verified users, and open team slots on the public tournament page.
  - Disables registration when all team slots are full.
  - Adds mobile-friendly CSS hooks to the flyer and registration team-member rows.
  - Logs public portal loads with tournament capacity data through the existing front-end logging pipeline.

- `src/index.css`
  - Adds responsive tournament flyer and registration form rules to prevent mobile horizontal overflow.
  - Adds shared tournament capacity stat-card layout.

- `test/app.test.js`
  - Updates existing tournament tests for the new team/capacity language and dynamic insert path.
  - Adds tests for migration registration, default team-slot capacity, capacity stat display, full-slot blocking, correlated logging hooks, and mobile layout rules.

## Migration deployment directions

1. Copy the changed files into the application at the paths listed above.
2. Confirm production `.env` contains the existing database settings and `PORT` value. No port values were hardcoded in the application changes.
3. Run `npm install` in the deployment environment. The existing `postinstall` script runs `npm run db:migrate && npm run build`, so migration `20260513_033_tournament_team_slot_limit` is applied automatically before the build.
4. If production dependencies are already installed and you do not run `npm install`, run this manually before starting the app:

   ```bash
   npm run db:migrate
   ```

5. Verify the schema change:

   ```sql
   SHOW COLUMNS FROM tournaments LIKE 'team_slot_limit';
   ```

   Expected column: `team_slot_limit INT NOT NULL DEFAULT 24`.

6. Start or restart the application using the existing process manager or `npm start`.

## Verification directions

Run these checks after applying the files:

```bash
npm test
npm run build
```

Expected result in this workspace: `npm test` passed 78 tests and `npm run build` completed successfully.

## Logging directions

The existing log files remain separate and searchable by the common correlation id:

- `logging/access.log`
- `logging/api.log`
- `logging/frontend.log`
- `logging/error.log`

For a tournament transaction, search the same `correlationId` across those files to view request access, API events, front-end events, and errors together.
