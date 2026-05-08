# Tournament time fields, sponsor availability, and cancelled cleanup deployment directions

## Changed application paths

Copy these files into the same paths in the application:

- `server/index.js`
  - Removes manual host/organizer tournament DELETE API routes.
  - Starts the cancelled tournament cleanup scheduler after storage initialization.
  - Persists the new tournament template JSON fields through the existing `template_data` column: `teeTime` and `sponsorsAvailable`.

- `server/lib/cancelled-tournament-cleanup.js`
  - Adds the scheduled cancelled-tournament cleanup job.
  - Schedules cleanup for every Sunday at 18:00 Mountain Time using `America/Denver` so DST is handled by Node's time-zone data.
  - Deletes tournaments with `status = 'cancelled'` through the safe tournament deletion helper.
  - Logs lifecycle events with one correlation id per cleanup run.

- `server/lib/tournament-delete.js`
  - Safe delete helper used by the scheduled job.
  - Deletes only tournament-owned records that can be safely removed:
    - `tournament_registrations`
    - `organizer_tournament_invites`
    - `tournaments`
  - Does not delete shared users, teams, host accounts, organizer accounts, or logs.

- `src/lib/accounts.ts`
  - Removes manual delete client functions from the front-end API surface.
  - Extends template data use through the existing tournament payload.

- `src/lib/tournament-templates.ts`
  - Adds separate `teeTime` and `checkInTime` template fields.
  - Adds `sponsorsAvailable` template data.
  - Adds a separate check-in-time attribute row key for the tournament flyer.

- `src/components/TournamentTemplateFields.tsx`
  - Adds a separate Tee time input next to Check-in time.
  - Adds a Sponsors available checkbox on the tournament modification/template form.

- `src/pages/TournamentPortal.tsx`
  - Shows Check-in time and Tee time as two separate tournament flyer rows.
  - Moves the sponsors section above the contact section.
  - Changes the sponsors heading to `SPONSERS - available` when the Sponsors available checkbox is checked, otherwise `SPONSORS`.

- `src/pages/HostPortal.tsx`
  - Removes manual Delete tournament buttons.
  - Shows the red cancellation message when a tournament status is `cancelled`:
    - `This tournament is scheduled to be deleted because it is cancelled`
  - Logs front-end display of the cancellation cleanup notice.

- `src/pages/OrganizerTournaments.tsx`
  - Removes manual Delete tournament buttons.
  - Shows the same red cancellation message when a tournament status is `cancelled`.
  - Logs front-end display of the cancellation cleanup notice.

- `test/app.test.js`
  - Adds/updates tests for separate tee/check-in fields, sponsor availability, sponsor/contact ordering behavior, removal of manual deletes, and Sunday 18:00 MT cancelled tournament cleanup.

## Production deployment steps

1. Back up the production application and database.
2. Copy the changed files into the application paths listed above.
3. Run:

```bash
npm install
```

The existing `postinstall` script already runs the database migration process and production build:

```bash
npm run db:migrate && npm run build
```

4. Restart the Node application process.
5. Verify application startup logs show the cancelled tournament cleanup scheduler entry.
6. Verify cancelled tournaments are displayed with the red scheduled-deletion message on:
   - `/host/portal`
   - `/organizer/portal`
7. Verify manual `Delete tournament` buttons no longer appear on either portal.
8. Verify the tournament page shows separate Check-in time and Tee time rows and that sponsors appear above Contact.

## Migration notes

No new database schema migration is required for these changes.

The new `teeTime` and `sponsorsAvailable` values are stored in the existing `tournaments.template_data` JSON column. The existing npm install migration process remains unchanged and continues to support deployment in other development environments and production.

## Scheduled cleanup behavior

- Runs every Sunday at 18:00 Mountain Time.
- Selects all tournaments with `LOWER(status) = 'cancelled'`.
- Deletes tournament-owned records inside safe transactional delete handling.
- Keeps shared/global data intact:
  - users
  - teams
  - host accounts
  - organizer accounts
  - logs

## Logging

The cleanup job writes scheduler and transaction logs with a cleanup correlation id:

- `logging/access.log`
  - scheduler initialization/next-run messages
- `logging/api.log`
  - cleanup start, per-tournament delete, and cleanup completion messages
- `logging/error.log`
  - cleanup failures
- `logging/frontend.log`
  - front-end cancellation notice display events

Search the shared `correlationId` from cleanup entries in `api.log` and `error.log` to trace one cleanup run.

## Validation completed

```bash
npm test
npm run build
```
