# Tournament Flyer and Completed Leaderboard Changes

## Summary

This update changes the shared host/organizer tournament creation and public tournament flyer behavior.

### Tournament creation format field

The shared tournament template editor now uses a plain text field for **Tournament format**. The field uses `4-Person Scramble` as its placeholder. The previous browser datalist/dropdown behavior was removed so hosts and organizers can type any format directly.

### Public tournament flyer before completion

For published tournaments:

- The registration helper paragraph beginning with `Only golfers signed in...` has been removed.
- Team start assignments are displayed before the Date, Organizer, and Host information.
- Registration behavior itself is unchanged for published tournaments.

### Completed tournament flyer

A tournament with status `completed` remains available through its existing `/tournaments/:id-or-identifier` public URL.

The completed public page:

- Keeps the tournament flyer.
- Shows a static **Final Leaderboard** immediately below the flyer.
- Does not show team start assignments.
- Does not show the secondary Date / Organizer / Host information card.
- Does not show the registration information or registration controls.
- Keeps the QR-code endpoint available so the tournament flyer QR code continues to resolve after completion.

The final leaderboard is built from the existing `tournament_team_scores` data and registered tournament teams. It displays team position, team name, score relative to par, total strokes, and whether an 18-hole score is final. Teams without a recorded score are retained at the bottom of the leaderboard instead of disappearing.

Host and organizer tournament lists continue exposing the tournament page URL after a tournament is completed, labeled as a tournament results URL rather than a registration URL.

## Backend and data source

No database schema change is required for this request.

The implementation uses the existing `tournament_team_scores` table created by:

`migration_scripts/20260728_063_tournament_team_scores.sql`

A new server helper was added at:

`server/lib/tournament-final-leaderboard.js`

It loads the existing score records, merges them with registered tournament teams, calculates relative-to-par values from saved hole data, and sorts the final standings.

The public tournament endpoint continues hiding registration roster data. For completed tournaments it also removes start-assignment data from the public response and exposes only the sanitized final leaderboard rows.

## Logging and correlation IDs

The existing request correlation ID continues to bind the transaction across:

- `logging/access.log`
- `logging/api.log`
- `logging/error.log`
- `logging/frontend.log`

Additional diagnostic events include:

- `completed_tournament_final_leaderboard_loaded`
- `completed_tournament_final_leaderboard_render_ready`

The normal `tournament_portal_loaded` API and frontend events now also include tournament status and final leaderboard team count.

## Changed application paths

- `docs/COMPLETED_TOURNAMENT_FLYER_LEADERBOARD_DIRECTIONS.md`
- `package.json`
- `server/index.js`
- `server/lib/tournament-final-leaderboard.js`
- `src/components/TournamentTemplateFields.tsx`
- `src/index.css`
- `src/lib/accounts.ts`
- `src/pages/HostPortal.tsx`
- `src/pages/OrganizerTournaments.tsx`
- `src/pages/TournamentPortal.tsx`
- `test/app.test.js`
- `test/tournament-final-leaderboard.test.js`
- `test/tournament-start-schedule.test.js`

## Deployment

Apply the changed files while preserving their paths, then run from the GolfHomiez application root:

```bash
npm install
```

The existing `postinstall` process remains:

```text
npm run cleanup:project-files && npm run db:migrate && npm run build
```

No new migration is needed for this request, but `npm install` should still be used so all migrations already registered by the project are applied consistently in the target environment.

For stage and production environments where a migration failure must stop deployment, continue using:

```env
REQUIRE_DB_MIGRATIONS=true
```

Restart the application with the existing PM2 or production process-manager configuration after installation/build completes.

## Validation performed

- `npm test`: 216 passed, 0 failed.
- `npm run test:security`: 8 passed, 0 failed.
- Node syntax checks passed for the modified server and leaderboard test files.
- TypeScript transpilation checks passed for the modified TypeScript/TSX files.
- No dependencies were added.
- No port values were added or hardcoded.

A registry-backed `npm audit --audit-level=high --omit=dev` was attempted, but the configured package registry returned HTTP 404 for the npm audit endpoint. The project dependency-security tests passed, and this request does not add or modify dependencies.

The production Vite build cannot complete in this Linux workspace using the uploaded Windows `node_modules`. The Vite launcher is not executable here and direct invocation reaches Rollup but fails because `@rollup/rollup-linux-x64-gnu` is absent. A clean `npm install` on the target deployment platform installs the correct native Rollup package before running the existing postinstall build.
