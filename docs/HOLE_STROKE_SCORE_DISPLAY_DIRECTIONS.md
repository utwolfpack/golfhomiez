# Hole Stroke Score Display

## Purpose

Per-hole stroke counts shown in leaderboard and round-summary views now use one shared golf-score symbol treatment so Challenge, saved-round, tournament scoring, and completed-tournament leaderboard views remain consistent.

## Display rules

`src/components/HoleStrokeScore.tsx` calculates the result from the saved hole score and par:

- Albatross (3 or more under par): heart outline with soft-red stroke-count text.
- Eagle (2 under): double-circle border with soft-green text.
- Birdie (1 under): single-circle border with soft-green text.
- Par: no border/icon, soft-green text.
- Bogey (1 over): single-square border with soft-red text.
- Double bogey (2 over): double-square border with soft-red text.
- Triple bogey or higher: burst/Max outline matching the supplied legend concept, with soft-red text.
- Missing par: the stroke count remains neutral because the result relative to par cannot be determined.

The visual styling is defined in `src/index.css`. The SVG outlines are inline and require no new runtime dependency or image request.

## Views using the shared component

- `src/components/RoundDetailModal.tsx` — saved solo round hole review and Team Challenge round comparison.
- `src/pages/Challenges.tsx` — Team Challenge and Individual Challenge hole-by-hole round summaries.
- `src/components/TournamentTeamScoreModal.tsx` — tournament team round summaries opened from the live leaderboard.
- `src/pages/TournamentPortal.tsx` — completed tournament final leaderboard hole strip.

Completed tournament leaderboard API rows now retain normalized saved-hole data through `server/lib/tournament-final-leaderboard.js` and `src/lib/accounts.ts` so the public tournament result view can use the same per-hole symbols.

## Logging

Existing frontend round-summary and completed-tournament leaderboard logging now records `holeScoreDisplayFormat: golf_score_symbols_v1`. This keeps display-version information associated with the existing correlation-ID transaction logs without creating a separate logging path.

## Deployment

No database schema change is required and no migration was added. No npm dependency was added. Existing application port configuration remains unchanged.

Apply the changed files at their normal project-relative paths and deploy through the existing install/migration/build process.
