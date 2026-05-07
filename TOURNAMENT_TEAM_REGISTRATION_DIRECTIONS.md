# Tournament Team Registration Changes

## Changed application paths

- `src/pages/TournamentPortal.tsx` — tournament registration now requires a team, supports selecting an existing qualifying team, supports creating a new tournament team, and displays signed-up teams with roster details.
- `src/pages/HostPortal.tsx` — tournament modification no longer shows the public visibility checkbox and registered tournament entries include team and roster information with times formatted without milliseconds.
- `src/pages/OrganizerTournaments.tsx` — tournament modification no longer shows the public visibility checkbox and registered tournament entries include team and roster information with times formatted without milliseconds.
- `src/pages/Profile.tsx` — first-sign-in profile enrichment replaces `?enrich=1` with `?enriched=1` after save so the user is not stuck on the initial enrichment state.
- `src/lib/accounts.ts` — tournament registration API payload and response types now include team fields; added `fetchMyTeams()` for team selection.
- `src/lib/time-format.ts` — shared UI date/time formatting helper that omits milliseconds.
- `server/index.js` — tournament portal visibility is based on `status === 'published'`; registration validates two-person/four-person team sizes, verifies existing-team membership, creates new teams when requested, stores team snapshot data on the registration, and logs validation failures with the existing correlation-id logger.
- `server/lib/rbac.js` — tournament creation derives public visibility from published status instead of an independent checkbox value.
- `server/migrations/index.js` — adds app migration `20260507_024` to the npm-install migration runner.
- `migration_scripts/20260507_024_tournament_registration_teams.sql` — production SQL migration for the new tournament registration team columns.
- `test/app.test.js` — adds regression coverage for team registration, published-status public visibility, removed checkbox, no-millisecond time formatting, and profile enrichment query cleanup.

## Migration/deployment directions

1. Back up the production database before deploying.
2. Deploy these changed files.
3. Ensure production `.env` contains the correct `PORT` value. No port values were hardcoded in this change.
4. Run `npm install` in the application root. The existing `postinstall` script runs `npm run db:migrate && npm run build`, and `server/migrations/index.js` now includes migration `20260507_024`.
5. If you need to run the migration manually, execute `npm run db:migrate`, or apply `migration_scripts/20260507_024_tournament_registration_teams.sql` directly against the production database.
6. Restart the application after the migration/build completes.

## Verification performed

- `npm test` — passed, 59 tests.
- `npm run build` — passed after refreshing local optional Rollup dependencies with `npm install --ignore-scripts` because the unpacked zip's `node_modules` was missing Rollup's native optional package.
