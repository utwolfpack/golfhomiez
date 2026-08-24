# Challenge sections, tournament date, and profile save changes

## Challenge page

Expanded challenges now expose three independent sibling disclosure sections: Challenge Settings, Challenge Score, and Challenge Discussion. All three sections are collapsed whenever a challenge line item is opened or reopened. Expanding/collapsing a section is logged through the existing frontend correlation-id logger as `challenge_section_expanded` or `challenge_section_collapsed`.

Completed challenge line items show the result without requiring the challenge to be expanded. Team Challenges show the two team results and the winning team (or a tie). Individual Challenges show the first-place golfer from the saved-hole leaderboard; golfers without at least one saved hole remain excluded.

For Team Challenges, the team-versus-team line is a link beneath the Team Challenge line-item heading. Selecting it opens a Team Challenge golfers modal. The modal uses the existing `/api/teams` data and displays each member's saved name when available, otherwise the member email. No schema change is required.

## Find Tournament date handling

Find Tournament now sends the browser IANA timezone (for example, `America/Denver`) with the search request. Server date-range validation computes "today" in that timezone rather than using the server UTC date. This prevents a valid local-today tournament date from being rejected after UTC has rolled into the next day, including the Mountain Time issue that occurred after 6:00 PM during daylight time.

The timezone is used only for date-boundary validation. Tournament date storage and date-only query values remain `YYYY-MM-DD`.

## Profile save behavior

After a successful profile save, the application now navigates to `/profile` with replacement navigation. This also clears a prior `?enrich=1` query while keeping the golfer on the Profile page rather than returning to Home.

## Deployment

No database schema change is required, so no new migration was added. Existing migrations continue to run through the project's `postinstall` / `db:migrate` process. No ports or dependencies were added or changed.

Changed implementation files for this follow-up are:

- `src/pages/Challenges.tsx`
- `src/pages/FindTournament.tsx`
- `src/pages/Profile.tsx`
- `src/lib/accounts.ts`
- `src/index.css`
- `server/lib/tournament-discovery.js`
- `server/index.js`
- `test/challenge-enhancements.test.js`
- `test/tournament-discovery.test.js`
- `test/app.test.js`

## Verification

Run focused tests with:

```bash
node --test test/challenge-enhancements.test.js test/tournament-discovery.test.js
```

Run the full suite with:

```bash
npm test
```

The supplied archive includes a Windows-oriented `node_modules`; a clean `npm install` in the deployment environment is required before the production Vite build on Linux.
