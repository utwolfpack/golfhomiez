# Host portal tournament edit and published registration URL changes

## Changed files and application paths

- `server/index.js`
  - Adds `PUT /api/host/tournaments/:id` so an authenticated host can update tournaments owned by their golf-course account.
  - Host authorization matches tournaments by `host_account_id`, golf-course name, or host email associations already used by the host portal list.
  - Adds published golfer registration URL metadata to host and organizer tournament payloads as `registrationUrl`.
  - Uses the existing public tournament portal lookup, so tournament golfers can register at the supplied URL.

- `src/lib/accounts.ts`
  - Adds the `registrationUrl` field to the `Tournament` type.
  - Adds `updateHostTournamentRecord()` for the host portal update API.

- `src/pages/HostPortal.tsx`
  - Makes host tournament tiles keyboard/mouse clickable.
  - Opens the same tournament edit fields used by organizers: name, description, start date, end date, status, and public visibility.
  - Shows `Golfer registration URL` in tournament metadata when the tournament status is `published`.

- `src/pages/OrganizerTournaments.tsx`
  - Shows `Golfer registration URL` in tournament metadata when the tournament status is `published`.
  - Organizer capabilities remain edit-only for host-invited tournaments.

- `test/app.test.js`
  - Adds coverage checks for the host edit API, clickable host portal edit functionality, and published registration URL metadata.

## Deployment / implementation steps

1. Copy the changed files into the same paths in the application.
2. Run `npm install` if dependencies are not installed.
3. Run validation:
   - `node --check server/index.js`
   - `node --test test/app.test.js`
   - `npm run build`
4. Restart the application server.
5. Verify as a host:
   - Log in at `/host/login`.
   - Open `/host/portal`.
   - Click any tournament tile for the host golf-course.
   - Modify tournament metadata and save.
   - Set status to `published`; confirm `Golfer registration URL` appears on the tile.
6. Verify as an organizer:
   - Log in at `/organizer/login`.
   - Open `/organizer/portal`.
   - Confirm organizers can only modify invited tournaments and cannot create tournaments.
   - Confirm published invited tournaments show `Golfer registration URL`.

## Migration scripts

No schema changes were required for this change, so no new migration script is included.

The change uses existing tournament columns and existing public tournament portal routes.
