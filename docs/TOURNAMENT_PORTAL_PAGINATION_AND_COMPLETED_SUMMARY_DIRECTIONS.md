# Tournament Portal Pagination and Completed Summary

## Scope

This update refines the host and organizer tournament-management experience and adds a completed-tournament summary without introducing new database columns or dependencies.

## User-interface changes

### Host portal

Path: `/host/portal`

- Removes the `Sign out of host portal` and `Reset host password` buttons from the host tournament portal.
- Removes the helper text `Select a line item to modify one tournament at a time.`.
- Removes the helper text `Other tournament line items are hidden while this tournament is being modified.`.
- Hides the Create Tournament section while an existing tournament is selected for editing.
- Shows at most 10 active or archived tournament line items per page and provides Previous/Next pagination when more than 10 records exist.
- Adds tournament Status to every tournament management line item.
- Adds a Tournament Summary editor immediately below the Team Start Schedule editor.

### Organizer portal

Path: `/organizer/tournaments`

- Removes the same line-item editing helper text.
- Shows at most 10 active or archived invited tournaments per page with Previous/Next pagination.
- Adds tournament Status to each management line item.
- Adds the Tournament Summary editor immediately below the Team Start Schedule editor.

### Completed tournament page

Path: `/tournaments/<tournament-id-or-identifier>`

When a tournament status is `completed`, a saved Tournament Summary is rendered directly below the Final Leaderboard. Empty summaries are omitted.

## Data storage

No database schema change is required. The tournament summary is stored in the existing `tournaments.template_data` JSON payload as:

```json
{
  "tournamentSummary": "Final tournament recap text"
}
```

The API sanitizer trims the value and limits it to 5,000 characters before persistence. The existing tournament update APIs for hosts and organizers persist the value.

## Logging

The existing request correlation ID remains in use across access, API, error, and frontend logs.

Tournament update logging now records whether a tournament summary is present and its character length. Pagination changes emit frontend events:

- `host_tournament_page_selected`
- `tournament_page_selected`

No summary text itself is written to application logs.

## Changed application files

- `server/index.js`
- `server/lib/rbac.js`
- `src/components/TournamentManagementLineItem.tsx`
- `src/components/TournamentTemplateFields.tsx`
- `src/index.css`
- `src/lib/tournament-templates.ts`
- `src/pages/HostPortal.tsx`
- `src/pages/OrganizerTournaments.tsx`
- `src/pages/TournamentPortal.tsx`
- `test/app.test.js`
- `test/tournament-archive.test.js`
- `docs/TOURNAMENT_PORTAL_PAGINATION_AND_COMPLETED_SUMMARY_DIRECTIONS.md`

## Database migrations

No migration was added because this change uses the existing `template_data` JSON column. The existing project migration process remains unchanged and continues to run during `npm install` through the existing `postinstall` script.

For stage/production environments, continue using the existing migration requirement setting when applicable:

```env
REQUIRE_DB_MIGRATIONS=true
```

## Deployment

Extract the changed-files ZIP into the GolfHomiez project root while preserving relative paths, then run:

```bash
npm install
```

Restart the application using the environment's existing PM2/process-manager configuration.

No port settings were changed or hardcoded.

## Validation performed

- Full application test suite: 228 passed, 0 failed.
- Dependency-security tests: 8 passed, 0 failed.
- JavaScript syntax checks passed for changed server/test files.
- Changed TypeScript/TSX files transpile successfully.
- Full TypeScript diagnostics were compared against the immediately preceding cumulative project; no new TypeScript errors were introduced.
- `npm audit --audit-level=high --omit=dev` was attempted, but the sandbox could not resolve `registry.npmjs.org` (`EAI_AGAIN`). No dependency or package-version changes were made.
- The production Vite build was attempted. The uploaded project contains Windows-oriented `node_modules`; this Linux environment cannot load `@rollup/rollup-linux-x64-gnu`. A clean `npm install` on the deployment platform installs the appropriate native Rollup package before the existing postinstall build runs.
