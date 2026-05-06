# Tournament portal changeset directions

## Application paths changed

- `server/index.js` — Adds tournament portal APIs, authenticated tournament registration, host-portal tournament linkage, organizer tournament listing/creation endpoints, and correlated API logging for these transactions.
- `server/migrations/index.js` — Registers the new migration with the application migration runner.
- `migration_scripts/20260427_020_tournament_portals_registrations.sql` — Creates tournament registration persistence and portal lookup indexes.
- `src/App.tsx` — Adds routes for `/organizer/portal`, `/organizer/register`, and `/tournaments/:id`.
- `src/lib/accounts.ts` — Adds tournament portal and registration API client functions and portal link fields.
- `src/pages/OrganizerTournaments.tsx` — Links each organizer tournament card to its generated tournament portal.
- `src/pages/TournamentPortal.tsx` — New tournament portal page with tournament details and Golf Homiez-account-only registration flow.
- `src/pages/HostPortal.tsx` — Shows tournaments linked to the signed-in host account and links them to tournament portals.
- `test/app.test.js` — Adds source-level coverage for tournament portal routes, UI links, authenticated registration, correlated registration logging, and migration presence.

## Production migration directions

1. Back up the production database before applying schema changes.
2. Deploy the changed application files.
3. Apply the schema update in one of these ways:
   - Preferred: run the existing migration runner from the application root: `npm run db:migrate`.
   - Manual SQL: run `migration_scripts/20260427_020_tournament_portals_registrations.sql` against the production MySQL database.
4. Restart the Node application after migrations finish.
5. Verify these endpoints after deployment:
   - `GET /api/tournaments` from an organizer user session.
   - `GET /api/tournament-portals/<tournament-id>` for a published/non-draft tournament.
   - `POST /api/tournament-portals/<tournament-id>/register` from a signed-in Golf Homiez user.
   - `GET /api/host/portal` from a host account session.
6. Diagnose transaction lifecycle by searching the same `correlationId` across `logging/access.log`, `logging/api.log`, `logging/error.log`, and `logging/frontend.log`.

## Port handling

No port values were hardcoded in these changes. The server continues to bind from `process.env.PORT`.
