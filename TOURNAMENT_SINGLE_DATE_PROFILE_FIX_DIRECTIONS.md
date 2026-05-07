# Tournament Single-Date and Profile Enrichment Fix Directions

## Changed files and application paths

Copy these files into the same paths in the application:

- `src/lib/time-format.ts`
  - Shared UI formatter for date/time values without milliseconds.
- `src/pages/HostPortal.tsx`
  - Host tournament modification UI now uses one `Tournament date` field and sends `endDate: null` on updates.
- `src/pages/OrganizerTournaments.tsx`
  - Organizer tournament modification UI now uses one `Tournament date` field and sends `endDate: null` on updates.
- `src/pages/TournamentPortal.tsx`
  - Public tournament portal displays a single `Date` value instead of a date range.
- `src/pages/MyTournaments.tsx`
  - Registered tournaments page displays one tournament date and formats registration times without milliseconds.
- `src/pages/Profile.tsx`
  - Initial profile enrichment save refreshes profile status, replaces the enrichment query string, and routes the user to `/?profileEnriched=1` so they are not left on the initial profile page.
- `server/index.js`
  - Organizer and host tournament update payloads now clear `endDate`; outbound tournament emails refer to `Tournament date` only.
- `server/lib/rbac.js`
  - Tournament payload sanitization ignores date-range end dates and stores `endDate: null`.
- `test/app.test.js`
  - Adds/updates static regression tests for no-millisecond time formatting, profile enrichment query clearing, and single-date tournament behavior.

## Migration scripts

No database schema migration is required for this change. The existing `tournaments.end_date` column is retained for backward compatibility, but all updated host/organizer tournament writes now clear it by sending/storing `NULL`.

The existing npm install flow already runs migrations through:

```bash
npm run db:migrate
```

which is wired in `package.json` as part of `postinstall`.

## Production deployment steps

1. Back up the production application and database.
2. Copy the files listed above into the same paths in the deployed application.
3. Install dependencies so the existing postinstall migration flow runs:

```bash
npm install
```

4. Build the client:

```bash
npm run build
```

5. Restart the Node process or hosting service.

## Verification performed

```bash
npm test
npm run build
```

Both completed successfully in the updated working tree.
