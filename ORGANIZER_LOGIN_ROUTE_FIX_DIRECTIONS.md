# Organizer login route fix

## Changed files
- `src/App.tsx`
- `test/app.test.js`

## Application paths affected
- `/organizer/login`
- `/organizer/register`
- `/organizer/portal`
- `/golfadmin`

## What changed
- Restored `/organizer/login` as a public organizer-auth entry route instead of allowing it to fall through or be protected by the normal user `ProtectedRoute`.
- Restored `/organizer/register` to the organizer login-entry flow so invited organizers can create organizer access without first being redirected to `/login`.
- Kept `AdminAuthProvider`, `OrganizerAuthProvider`, and `HostAuthProvider` high enough in `App.tsx` so navbar and route guards can safely call their auth hooks.
- Preserved the tournament portal route at `/tournaments/:id`.

## Test coverage
- `test/app.test.js` now verifies that organizer login and registration routes are wired through `LoginEntryRoute mode="organizer"` and are not wrapped in the normal user `ProtectedRoute`.

## Migration
No schema changes were made. No migration script is required.

## Deployment
1. Copy the changed files into the same paths in the application.
2. Run the existing test command, for example `npm test`.
3. Restart/redeploy the app.
4. Verify `/organizer/login` renders the organizer login form and does not redirect to `/login`.
