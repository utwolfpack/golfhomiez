# Organizer invite edit restore

Changed files:

- `server/index.js`
  - Keeps host tournament creation and host organizer-invite endpoints intact.
  - Blocks organizer-created tournaments with `403` so organizer accounts can only work on host-invited tournaments.
  - Adds `PUT /api/organizer/tournaments/:id` for organizer edits. The update is allowed only when the authenticated organizer matches an invite email, tournament organizer email, or linked organizer account.
  - Allows public tournament portal lookup by either `tournaments.id` or `tournaments.tournament_identifier`, fixing host-generated invite/portal identifiers that previously produced `Tournament not found`.
  - Adds API logging for blocked organizer creation, organizer update success, update validation failure, and update-not-found cases.

- `src/pages/OrganizerTournaments.tsx`
  - Removes the organizer tournament creation form and host golf-course lookup from `/organizer/portal`.
  - Displays only tournaments returned from the organizer portal summary, which are host-invited/authorized tournaments.
  - Adds an inline edit form for invited tournaments.
  - Supports `/organizer/portal?tournament=<id-or-identifier>` from invite emails by automatically opening the matching invited tournament for editing.
  - Adds front-end transaction/error logging around edit start, update success, and update failure.

- `src/lib/accounts.ts`
  - Adds `updateOrganizerTournamentRecord()` for the organizer edit endpoint.

- `test/app.test.js`
  - Adds regression coverage verifying the organizer portal no longer exposes tournament creation, uses the organizer update endpoint, and tournament portal lookup accepts host-generated identifiers.

Schema/migration notes:

- No new schema changes are required for this fix.
- Production must already have the host tournament/organizer invite migration applied: `migration_scripts/20260423_019_host_tournaments_organizer_invites.sql`.
- That migration provides `organizer_tournament_invites`, `tournaments.tournament_identifier`, and `tournaments.organizer_email`, which this restore uses.

Implementation steps:

1. Copy the changed files into the same paths in the application.
2. Confirm production has run `migration_scripts/20260423_019_host_tournaments_organizer_invites.sql`.
3. Run `npm install` if dependencies are not installed.
4. Run `npm test` or `node --test test/app.test.js`.
5. Build and restart the app using the project’s normal deployment process.

Verification:

1. Sign in as a host and create a tournament from `/host/portal`.
2. Invite an organizer from the host tournament card.
3. Sign in as that organizer and open `/organizer/portal` or the emailed `/organizer/portal?tournament=<identifier>` link.
4. Verify there is no `Create tournament` form.
5. Verify the invited tournament appears and can be modified with `Save tournament changes`.
6. Verify an organizer who was not invited cannot update the tournament.
7. Search logs by correlation id across access/API/front-end logs to trace the update lifecycle.
