# Tournament archive and portal line-item management

## Scope

This change updates the host and organizer tournament-management portals so tournament records use compact line items, only one tournament is editable at a time, and tournaments can be soft-archived and restored without deleting their data.

The host portal no longer includes the golf-course/email/validated card containing the **Update host profile** button. The organizer tournament portal likewise no longer includes its portal-profile update card. The existing profile routes and navigation remain available outside these tournament-management cards.

## Portal behavior

Active tournament line items show the available management data:

- Tournament name
- Tournament Date
- Organizer when assigned
- Golfer Registration URL when the tournament is publicly addressable
- Teams Registered
- Team Slots Open when a team-slot limit exists

Select an active line item to edit it. While editing, all other tournament line items are hidden. The line item supports mouse, Enter, and Space selection.

Each active line item has an **Archive** action. Archived tournaments are available through **View archived tournaments** and can be returned to the active list with **Restore to active**. Archiving is a soft state: it does not delete the tournament or replace its draft/published/completed/cancelled status. Restoring clears the archive timestamp and returns the tournament with its prior tournament status intact.

Archived tournaments are intentionally unavailable from public tournament pages, QR codes, GolfHomiez Find Tournaments results, and golf-course public-page tournament lists until restored. Archived cancelled tournaments are also excluded from the cancelled-tournament permanent cleanup job so they remain restorable.

## Database migration

The migration is:

`migration_scripts/20260810_070_tournament_archiving.sql`

It adds `tournaments.archived_at` and an index for archive filtering. The registered migration implementation in `server/migrations/index.js` checks for the column and index before adding them so the normal migration runner remains safe across development, stage, and production environments.

The project already runs migrations through `npm install` using the existing `postinstall` workflow. For stage and production, keep `REQUIRE_DB_MIGRATIONS=true` so deployment fails if required schema updates cannot be applied.

## API routes

Host:

- `POST /api/host/tournaments/:id/archive`
- `POST /api/host/tournaments/:id/restore`

Organizer:

- `POST /api/organizer/tournaments/:id/archive`
- `POST /api/organizer/tournaments/:id/restore`

Both route families use the existing host/organizer authorization checks, so an account can only archive or restore tournaments it can already manage.

## Logging

The existing request correlation ID is retained through access, API, error, and frontend logging. Archive-related diagnostics include:

- `host_tournament_archived`
- `host_tournament_restored`
- `organizer_tournament_archived`
- `organizer_tournament_restored`
- `host_tournament_archive_failed`
- `host_tournament_restore_failed`
- `tournament_archive_failed`
- `tournament_restore_failed`
- active/archived view-opened frontend events
- GolfHomiez tournament-search synchronization events

Use the correlation ID to follow an archive or restore action across `logging/access.log`, `logging/api.log`, `logging/error.log`, and `logging/frontend.log`.

## Deployment

1. Extract the changed-files package into the GolfHomiez application root and preserve the included relative paths.
2. Run `npm install`.
3. Verify migration `20260810_070` completes successfully.
4. Run `npm test` and `npm run test:security`.
5. Restart the existing application process using the deployment environment's normal PM2/process-manager configuration.

No port settings were added or changed, and no dependencies were added for this feature.
