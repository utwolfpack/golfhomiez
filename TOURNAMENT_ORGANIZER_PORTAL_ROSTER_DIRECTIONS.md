# Tournament Organizer Portal, Flyer, and Registration Roster Changes

## Changed file paths

Copy these files into the same paths in the application:

- `server/index.js`
- `server/lib/rbac.js`
- `src/components/TournamentTemplateFields.tsx`
- `src/lib/accounts.ts`
- `src/lib/time-format.ts`
- `src/pages/TournamentPortal.tsx`
- `src/index.css`
- `public/tournament-templates/TourneyBannerDefault.png`
- `test/app.test.js`

## What changed

- Organizer and host tournament template entry fee input now accepts currency-style values only and normalizes values to a dollar amount.
- Tournament template fields for `What fees include`, `Prize details`, and `Hole contests/extras` now show help tooltips and render entered rows as bullet-list previews.
- The default tournament banner image no longer contains the embedded Golf Homiez icon; the flyer renders the Golf Homiez emblem in the top-right corner instead.
- Public tournament page date displays no longer include time for the tournament date field.
- Tournament registration status now counts a user as registered/verified only when that specific authenticated user registered for the tournament.
- Team registration lists are grouped by team and show each member's tournament-specific registration status:
  - Registered and verified
  - Registered; verification pending
  - Needs tournament registration
- A team that already has a tournament slot can still let additional members register for that same team without consuming another team slot.
- Registration and capacity logging now includes team-level duplicate-slot details while preserving the existing correlation-id logging flow across access, API, error, and front-end logs.

## Database migration notes

No database schema change was required for this follow-up request, so no new SQL migration script is included.

The application already runs migrations during `npm install` through the existing `postinstall` process. Keep that process enabled for deployment and for other development environments.

## Deployment steps

1. Back up the current application files and database.
2. Copy the changed files listed above into the matching paths in the target application.
3. Run:

   ```bash
   npm install
   ```

   This keeps the existing install-time migration flow active. If dependencies are already installed and you are deploying manually, run:

   ```bash
   npm run db:migrate
   npm run build
   ```

4. Restart the application using the existing deployment process.

## Verification

Run these commands from the application root:

```bash
npm test
npm run build
```

Expected result from this patch:

- `npm test` passes all maintained tests.
- `npm run build` completes successfully.

## Port configuration

No port values were added or hardcoded. The application continues to use the existing environment-based port configuration.
