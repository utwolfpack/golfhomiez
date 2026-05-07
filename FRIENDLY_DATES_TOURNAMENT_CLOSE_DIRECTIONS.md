# Friendly dates and tournament close button changes

## Changed files and application paths

- `src/lib/time-format.ts`
  - Adds shared friendly, user-local date/time formatting in the requested `May 7 2026 – 8:28 am` style.
  - Handles date-only values as local calendar dates so tournament dates do not shift for the logged-in user's browser time zone.
  - Keeps the previous `formatDateTimeNoMilliseconds` export as a compatibility wrapper.

- `src/pages/TournamentPortal.tsx`
  - Formats displayed tournament dates and registration timestamps with the shared friendly date formatter.
  - Adds a `Close` button that returns users to `/my-tournaments`.

- `src/pages/MyTournaments.tsx`
  - Formats tournament dates and user registration dates with the shared friendly date formatter.

- `src/pages/HostPortal.tsx`
  - Formats hosted tournament dates and registered team signup dates with the shared friendly date formatter.

- `src/pages/OrganizerTournaments.tsx`
  - Formats organizer tournament dates and registered team signup dates with the shared friendly date formatter.

- `src/components/RoundDetailModal.tsx`
  - Formats round dates and logged-at dates with the shared friendly date formatter.

- `src/pages/AdminPortal.tsx`
  - Formats admin table date columns such as created, expires, and consumed dates with the shared friendly date formatter.

- `test/app.test.js`
  - Adds coverage that UI dates use the friendly user-local formatter.
  - Adds coverage that the tournament portal Close button routes back to `/my-tournaments`.
  - Updates existing no-milliseconds coverage to use the shared friendly formatter.

## Database migrations

No schema changes were made for this request, so no new migration script is required.

The existing install process still runs migrations through `package.json` postinstall:

```bash
npm install
```

## Deployment steps

1. Copy the changed files into the same paths in the application.
2. Run dependency installation so existing migrations continue to execute:

```bash
npm install
```

3. Run tests:

```bash
npm test
```

4. Build the application:

```bash
npm run build
```

5. Deploy the application normally.

## Verification performed

- `npm test` passed with 62 tests.
- `npm run build` passed.
