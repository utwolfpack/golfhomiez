# Duplicate Tournament Registration Guard

## Changed files and application paths

- `server/index.js`
  - Adds reusable authenticated-user lookup for routes that can behave differently for signed-in golfers.
  - Updates `GET /api/tournament-portals/:id` to return `isViewerRegistered` and `viewerRegistration` when the current signed-in user already has a registered row for the tournament.
  - Updates `POST /api/tournament-portals/:id/register` to check for an existing active registration before insert. Existing registrations return HTTP `409` with `alreadyRegistered: true` instead of updating/re-registering the row.
  - Adds API log event `tournament_registration_duplicate_blocked` with correlation id support through the existing request logging context.

- `src/lib/accounts.ts`
  - Extends `TournamentPortal` with `isViewerRegistered` and `viewerRegistration`.
  - Extends `TournamentRegistrationResult` with `alreadyRegistered` and `registration`.

- `src/pages/TournamentPortal.tsx`
  - Sets local registration state from `isViewerRegistered` on page load.
  - When the golfer is already registered, replaces the `Register for tournament` button with the label: `You are already registered for this tournament.`
  - Keeps the register button available only for signed-in golfers who are not already registered and where tournament registration is open.

- `test/app.test.js`
  - Adds coverage to verify the portal consumes `isViewerRegistered`, displays the already-registered label, removes `registered` from the button disabled path, and verifies the server duplicate-registration guard.

## Production deployment / migration instructions

No database schema migration is required for this change. The existing unique key on `tournament_registrations (tournament_id, auth_user_id)` remains the database backstop, and the server now blocks duplicate registrations before attempting to insert.

Deploy steps:

1. Copy the changed files into the same paths in the application.
2. Run `npm install` if dependencies are not already installed.
3. Run `npm test`.
4. Run the application with the existing environment configuration.
5. Sign in as a golfer who is already registered for a published tournament and open that tournament registration URL.
6. Verify the registration panel shows `You are already registered for this tournament.` and no `Register for tournament` button is shown.
7. Attempting to call the registration endpoint again for the same user/tournament should return HTTP `409` with `alreadyRegistered: true` and write `tournament_registration_duplicate_blocked` to the API logs.

## Validation performed

- Added source-level tests for backend duplicate-registration behavior and front-end already-registered UI behavior.
- `node --check server/index.js` was attempted in the extracted environment, but command execution was impacted by the same local dependency/runtime limitations seen in earlier packages. Run the validation commands above in the app environment after applying the files.
