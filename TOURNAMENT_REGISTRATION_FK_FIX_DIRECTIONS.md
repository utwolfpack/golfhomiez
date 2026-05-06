# Tournament Registration Foreign Key Fix

## Changed files

- `server/index.js`
  - Fixes `POST /api/tournament-portals/:id/register` so a golfer can register from a published tournament URL that uses `tournament_identifier`.
  - The route still accepts either `tournaments.id` or `tournaments.tournament_identifier` in the URL, but registration inserts now use the resolved `portal.tournament.id` value for `tournament_registrations.tournament_id`.
  - This prevents the MySQL foreign key error where the public identifier was inserted into `tournament_registrations.tournament_id` instead of the real tournament primary key.
  - Fixes the registration success log to use `req.user.email` and adds `requestedTournamentId` to preserve the public URL identifier in logs.

- `test/app.test.js`
  - Adds coverage confirming tournament registration resolves the tournament id before inserting and no longer references `req.organizerUser.email` in the golfer registration route.

## Production deployment

1. Copy the changed files into the same paths in the application:
   - `server/index.js`
   - `test/app.test.js`

2. No database schema migration is required for this fix.
   - The existing `tournament_registrations.tournament_id` foreign key remains correct.
   - The bug was in the route inserting the public identifier instead of the resolved tournament primary key.

3. Restart the Node server after replacing `server/index.js`.

4. Verify with a published tournament registration URL:
   - Open the published tournament URL from the host or organizer portal metadata.
   - Register as a golfer.
   - Confirm the row in `tournament_registrations` has `tournament_id` equal to the real `tournaments.id` value.

## Validation

Attempted:

```bash
node --test test/app.test.js
```

The test run could not complete in this environment because dependencies are not installed and Node cannot resolve `uuid`. Run `npm install` first, then rerun the test command locally.
