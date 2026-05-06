# User tournaments page changes

## Changed files and application paths

- `server/index.js`
  - Adds `GET /api/users/tournaments` for signed-in user accounts.
  - The route returns every tournament the authenticated user has registered for by joining `tournament_registrations` to `tournaments`.
  - The response includes the tournament metadata, registration count, public tournament URL/path, and the user's registration metadata including registered time.
  - API logging records `user_registered_tournaments_loaded` with the correlation id, authenticated user id, email, and tournament count.

- `src/lib/accounts.ts`
  - Adds `UserRegisteredTournament`, `UserTournamentsSummary`, and `fetchUserTournaments()` for the new page.

- `src/pages/MyTournaments.tsx`
  - Adds the logged-in user tournaments page at `/my-tournaments`.
  - Displays tournament name, description, dates, status, host, organizer, registered golfer count, tournament URL, and the user's registered timestamp.
  - Tournament tiles link back to the public tournament page.
  - Adds front-end logging for successful load and load failures.

- `src/App.tsx`
  - Registers `/my-tournaments` behind the existing user `ProtectedRoute`.

- `src/components/NavBar.tsx`
  - Adds `My Tournaments` to the signed-in user navigation dropdown menu.

- `test/app.test.js`
  - Adds source-level test coverage verifying the route, nav item, client API function, and backend SQL join used by the user tournaments feature.

## Migration instructions

No schema migration is required. This change uses the existing `tournament_registrations` and `tournaments` tables.

## Implementation instructions

1. Copy the changed files into the same paths in the application.
2. Restart the API server and front-end dev server.
3. Sign in as a user account that has registered for one or more published tournaments.
4. Open the account dropdown and choose `My Tournaments`.
5. Verify `/my-tournaments` lists the tournaments registered by that user and that each tile opens the tournament portal.

## Validation performed

- `node --check server/index.js` passed.
- `node --test test/app.test.js` could not complete in this extracted environment because `node_modules/uuid` is not installed. Run `npm install` first, then run `node --test test/app.test.js`.
