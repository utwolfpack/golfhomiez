# Tournament Summary Save Fix

## Summary

The host and organizer tournament editors already captured `templateData.tournamentSummary` in the browser, but the API update sanitizer in `server/index.js` rebuilt the template-data object without that property. As a result, selecting **Save tournament changes** sent the summary to the API, but the server removed it before writing `tournaments.template_data`.

This change routes host and organizer tournament updates through the shared tournament-template sanitizer in `server/lib/rbac.js`. The shared sanitizer preserves, trims, and limits `tournamentSummary` to 5,000 characters before the existing update statement serializes `template_data`.

Completed tournament pages already render `templateData.tournamentSummary` directly below the final leaderboard. Once the value is persisted, the existing completed-tournament flyer behavior displays it automatically.

## Changed files

- `server/index.js`
  - Uses the shared `sanitizeTournamentTemplateData` implementation for host and organizer tournament updates.
  - Removes the duplicate update-only template sanitizer that omitted `tournamentSummary`.
  - Existing correlation-ID update logging continues to record `tournamentSummaryPresent` and `tournamentSummaryLength` without logging summary contents.

- `server/lib/rbac.js`
  - Exports the existing `sanitizeTournamentTemplateData` helper so creation and update flows share the same field-preservation rules.

- `test/app.test.js`
  - Adds runtime coverage proving tournament summaries survive sanitization, whitespace is normalized, empty summaries become `null`, and the 5,000-character limit is enforced.
  - Adds regression coverage proving `server/index.js` uses the shared sanitizer rather than a second duplicate implementation.
  - Existing coverage continues to verify the completed tournament page renders the summary below the final leaderboard.

## Database migration

No database schema change is required. Tournament summaries continue to use the existing `tournaments.template_data` JSON/LONGTEXT storage.

The application's existing `npm install` postinstall migration process remains unchanged.

## Deployment

Copy the changed files into the same relative paths in the GolfHomiez project and run:

```bash
npm install
```

For environments that must fail deployment when migrations cannot run, continue using:

```env
REQUIRE_DB_MIGRATIONS=true
```

Restart the existing application process after installation/build completes.

## Verification

1. Open a tournament in either `/host/portal` or the organizer portal.
2. Enter text in **Tournament summary**.
3. Select **Save tournament changes**.
4. Re-open the tournament and confirm the summary remains populated.
5. Change the tournament status to **Completed**, save it, and open the tournament page.
6. Confirm **Tournament Summary** is displayed directly below **Final Leaderboard**.
7. Search `access.log`, `api.log`, `frontend.log`, and `error.log` using the request correlation ID if troubleshooting is required.

## Automated validation

Run:

```bash
npm test
npm run test:security
```

No dependency or port changes are part of this fix.
