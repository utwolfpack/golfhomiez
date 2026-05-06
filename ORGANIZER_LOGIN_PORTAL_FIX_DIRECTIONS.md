# Organizer Login Portal Fix

## Changed files and application paths

Copy these files into the same paths in the application:

- `src/App.tsx`
  - Keeps `/organizer/login` mounted after a successful auth session so the organizer login submit handler can validate organizer portal access and navigate to `/organizer/portal`.
- `src/pages/OrganizerLogin.tsx`
  - Stops logging out a successfully authenticated user when organizer portal loading fails.
  - Continues to navigate successful organizer logins to `/organizer/portal`.
- `server/index.js`
  - Adds `GET /api/organizer/portal` so organizer login and `/organizer/portal` receive JSON instead of the SPA HTML fallback.
  - Adds `GET /api/organizer/invite-eligibility` backend support used by organizer registration.
  - Logs organizer portal load, forbidden, and invite eligibility events with the existing correlation id infrastructure.
- `test/app.test.js`
  - Adds/updates regression coverage for organizer login staying on the organizer flow and backend portal validation.

## What this fixes

The logs showed a successful Better Auth email/password sign-in followed by a request to `/api/organizer/portal`. Because the route did not exist, the server returned `<!doctype ...` HTML from the SPA fallback, which the client tried to parse as JSON. That made organizer login look failed after sign-in and caused the prior cleanup path to sign the organizer out.

## Deployment steps

1. Stop the dev server or production process.
2. Copy the changed files into the application paths listed above.
3. Rebuild the front end:
   - `npm run build`
4. Run tests:
   - `npm test`
5. Restart the application server.
6. Verify:
   - Open `/organizer/login`.
   - Log in as an organizer.
   - Confirm the browser lands on `/organizer/portal`.
   - Confirm logs contain the same correlation id across access, api, and front-end log entries for `organizer_portal_loaded`.

## Migration

No schema migration is required for this fix. It uses the existing organizer, tournament, and invite tables created by prior migrations.
