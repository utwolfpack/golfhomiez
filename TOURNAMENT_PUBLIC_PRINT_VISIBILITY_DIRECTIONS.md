# Tournament public visibility and print-flyer update

## Changed files and application paths

Copy these files into the same paths in the application:

- `server/index.js`
  - Removes team roster, teams registered, and verified-user details from the public tournament portal API response while keeping those details available to host and organizer portal data flows.
  - Keeps server-side transaction logging with the existing correlation-id pattern and logs that public responses no longer include the team roster.

- `src/lib/accounts.ts`
  - Updates the tournament portal response type so public responses can omit team registration counts and roster data.

- `src/pages/TournamentPortal.tsx`
  - Keeps the Golf Homiez emblem positioned as a flyer-level top-right overlay when the default banner is used.
  - Hides the teams-signed-up section from public and golf-user tournament pages.
  - Removes tournament status, teams registered, and verified-user display from public and golf-user tournament pages.
  - Keeps only the public-facing open team slot count.
  - Updates print styling so the Print flyer action prints only the flyer, forces the desktop/non-mobile layout, and constrains it to one letter-size page.

- `src/pages/MyTournaments.tsx`
  - Removes tournament status and registered-golfer/team count display from the signed-in golf-user tournament list.

- `src/pages/HostPortal.tsx`
  - Keeps the teams-signed-up roster visible for hosts and shows each team member registration/verification status.

- `src/pages/OrganizerTournaments.tsx`
  - Keeps the teams-signed-up roster visible for organizers and shows each team member registration/verification status.

- `src/index.css`
  - Adds public slot summary styling and keeps the existing team member status styling used by host and organizer portals.

- `public/tournament-templates/TourneyBannerDefault.png`
  - Default tournament banner asset without the embedded Golf Homiez icon; the emblem is rendered by the flyer UI in the top-right corner instead.

- `test/app.test.js`
  - Adds/updates tests for public roster hiding, golf-user display cleanup, host/organizer roster visibility, and single-page non-mobile print styling.

## Database migrations

No schema changes were made for this request. No new migration script is required.

The existing migration process remains unchanged:

```bash
npm install
```

The project already runs database migrations through the `postinstall` script:

```json
"postinstall": "npm run db:migrate && npm run build"
```

For production deployment, after copying the changed files, run the normal deployment install/build process so existing pending migrations are applied:

```bash
npm install
npm test
npm run build
```

## Verification performed

The following commands were run successfully after the changes:

```bash
npm test
npm run build
```

Results:

- `npm test`: 79/79 tests passed
- `npm run build`: completed successfully
