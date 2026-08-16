# My Tournaments status and team score line-item changes

## Application paths

- `src/pages/MyTournaments.tsx` renders the golfer's My Tournaments line items.
- `src/components/TournamentTeamScoreModal.tsx` notifies the My Tournaments list when a team score changes.
- `src/lib/accounts.ts` defines the `teamScore` and `teamScoreUpdatedAt` values returned for a registered tournament.
- `server/index.js` loads the signed-in golfer's existing team score with the registered-tournament response and logs score/status summary counts with the request correlation id.
- `src/index.css` contains the Active/Completed tournament status text colors.

## Behavior

The registration-status pill is no longer rendered on My Tournaments. The line item displays tournament status instead. Published/active tournaments display `Active` in blue text, and completed tournaments display `Completed` in green text. Any other stored tournament status remains visible using neutral text rather than being incorrectly labeled Active.

The Team Score action remains available. When the signed-in golfer's registered team already has a stored tournament score, the action displays `Team Score: <score>`. If no score has been saved, it displays `Team Score`. Saving or clearing score data through the score modal updates the line item immediately.

## Backend and database

The existing `tournament_team_scores` data source is reused. `/api/users/tournaments` batch-loads score rows for the tournaments in the response and matches the score using the same tournament registration team-key rules used by tournament scoring. No database schema change is required, so no new migration is necessary.

The existing `package.json` `postinstall` script already executes `npm run db:migrate`, preserving migration execution for other environments. No port configuration or dependencies were changed.

## Logging

Existing correlation-id logging remains in use. The API registered-tournaments event includes tournament, active, completed, and scored-team counts. Front-end load/select/update events include tournament status and team-score information so a transaction can be traced with the shared correlation id through access, API, and frontend logs.
