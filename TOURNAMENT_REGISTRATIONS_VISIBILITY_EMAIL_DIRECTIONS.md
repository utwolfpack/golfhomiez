# Tournament registrations visibility and confirmation email changes

## Changed files and application paths

- `server/index.js`
  - Adds registration-list hydration for tournament portal objects used by `/api/host/portal`, `/api/organizer/portal`, and `/api/tournament-portals/:id`.
  - Sends a confirmation email after successful golfer registration at `/api/tournament-portals/:id/register`.
  - Logs confirmation-email success and confirmation-email errors with the current correlation id.

- `src/lib/accounts.ts`
  - Adds the `TournamentRegistration` type and registration fields on tournament API responses.

- `src/pages/HostPortal.tsx`
  - Displays registered golfer counts on host tournament tiles.
  - Displays registered golfer name, email, and registration time when the host opens/clicks a tournament tile for editing.

- `src/pages/OrganizerTournaments.tsx`
  - Displays registered golfer counts on organizer tournament tiles.
  - Displays registered golfer name, email, and registration time when the organizer opens/clicks a tournament tile for editing.

- `test/app.test.js`
  - Adds coverage checks for registration count/detail UI and registration confirmation email support.

## Migration scripts

No database schema migration is required for this change. It uses the existing `tournament_registrations` table and its existing `created_at`, `email`, `name`, and `status` columns.

## Production implementation

1. Copy the changed files into the matching paths in the application.
2. Confirm the existing tournament registration migration has already been applied in production:
   - `migration_scripts/20260427_020_tournament_portals_registrations.sql`
3. Confirm production email settings are configured in `.env` using the existing SMTP/Brevo variables used by `server/mailer.js`.
4. Restart the application.
5. Verify:
   - A host sees registered golfer counts on `/host/portal` tournament tiles.
   - An organizer sees registered golfer counts on `/organizer/portal` tournament tiles.
   - Clicking a tournament tile shows registered golfer name, email, and registration time.
   - Registering for a published tournament sends the golfer a confirmation email with tournament details and a tournament link.

## Validation performed

- `node --check server/index.js` passed.
- `node --test test/app.test.js` could not complete in this environment because `node_modules/uuid` is missing. Run `npm install` first, then run `node --test test/app.test.js`.
