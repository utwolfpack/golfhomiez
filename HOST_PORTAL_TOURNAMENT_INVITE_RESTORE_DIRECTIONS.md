# Host Portal Tournament Creation and Organizer Invite Flow Restore

## Changed files and application paths

- `server/index.js`
  - Restores host portal tournament listing, `POST /api/host/tournaments`, and `POST /api/host/tournaments/:id/invite`.
  - Restores organizer direct-auth endpoints and tournament portal endpoints needed by organizer invites:
    - `GET /api/organizer/session`
    - `POST /api/organizer/register`
    - `POST /api/organizer/login`
    - `POST /api/organizer/logout`
    - `GET /api/organizer/portal`
    - `GET /api/organizer/invite-eligibility`
    - `GET /api/tournament-portals/:id`
    - `POST /api/tournament-portals/:id/register`

- `server/lib/organizer-auth.js`
  - Sets organizer session TTL to 24 hours.
  - Adds sliding-session refresh by updating `organizer_sessions.expires_at` on authenticated activity.
  - Reissues the organizer session cookie from organizer-authenticated requests.

- `src/context/OrganizerAuthContext.tsx`
  - Adds front-end organizer activity tracking that refreshes organizer session state at most once per minute while active.

- `src/pages/HostPortal.tsx`
  - Restores the host portal UI for creating tournaments and sending/resending organizer invites.

- `test/app.test.js`
  - Adds static regression coverage for host tournament creation routes, organizer invite-flow routes, and organizer 24-hour sliding TTL behavior.

## Production deployment directions

1. Copy the changed files into the matching paths in the application.
2. Install dependencies if needed:
   ```bash
   npm install
   ```
3. Run tests:
   ```bash
   node --test test/app.test.js
   ```
4. Build/restart the application using the normal deployment process.

## Migration directions

No new schema changes were introduced by this restore. The restored routes use the existing tournament, organizer invite, organizer session, tournament registration, and host portal tables created by prior migrations, especially:

- `migration_scripts/20260423_019_host_tournaments_organizer_invites.sql`
- `migration_scripts/20260423_020_organizer_direct_auth.sql`
- `migration_scripts/20260427_020_tournament_portals_registrations.sql`
- `migration_scripts/20260427_021_separate_organizer_auth.sql`
- `migration_scripts/20260427_022_fix_organizer_session_token_hash.sql`
- `migration_scripts/20260501_023_auth_ttl_and_logging_support.sql`

Apply any of those missing migrations in production before deploying this restore.

## Verification

- Sign in as a host and open `/host/portal`.
- Create a tournament using the tournament name and organizer email fields.
- Confirm the API call succeeds against `POST /api/host/tournaments`.
- Confirm the organizer invite succeeds against `POST /api/host/tournaments/:id/invite`.
- Confirm the tournament appears under “Tournaments hosted here”.
- Use the invite link to register or log in as an organizer and confirm `/organizer/portal` shows the invited tournament.

## Test validation note

`node --check server/index.js` passed.

`node --check server/lib/organizer-auth.js` passed.

`node --test test/app.test.js` could not complete in this extracted environment because `node_modules/uuid` is not installed. Run `npm install` before running the full test suite.
