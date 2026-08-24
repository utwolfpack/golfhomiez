# Team Challenge Leaderboard Display

## Summary

The Team Challenge leaderboard now uses a compact hole-by-hole comparison layout modeled on the provided `teamLeaderboard.png` reference. The leaderboard displays Hole, Par, both team scores, Winner, and Points. The Push column is rendered only when the Team Challenge scoring game is `Skins - Push`.

For standard team stroke play, both Push and Points are hidden. For `Skins`, Points is shown and Push is hidden. For `Skins - Push`, both Points and Push are shown.

Each team score uses the shared `HoleStrokeScore` component, so birdie/eagle/bogey/etc. symbols and score colors are consistent with the rest of GolfHomiez. Team-name column headings remain selectable in the leaderboard so users can open that team's detailed round summary without restoring the previous POS/TEAM/ROUND/THRU/TOTAL leaderboard layout.

## Files

- `src/pages/Challenges.tsx` - Team Challenge leaderboard composition, conditional Push/Points columns, team-name round-summary links, hole score symbols, and leaderboard transaction logging.
- `src/components/RoundDetailModal.tsx` - Applies the same conditional Push/Points behavior to Team Challenge hole comparison tables shown in round review.
- `src/index.css` - Responsive 5/6/7-column Team Challenge table layouts and clickable team-header styling.
- `test/challenge-enhancements.test.js` - Regression coverage for the requested Team Challenge leaderboard format.
- `test/app.test.js` - Updates existing Team Challenge assertions to the new hole-comparison leaderboard structure.

## Responsive behavior

The table has three responsive column configurations:

- Standard team score: Hole / Par / Team / Team / Winner
- Skins: Hole / Par / Team / Team / Winner / Points
- Skins - Push: Hole / Par / Team / Team / Winner / Push / Points

Mobile breakpoints reduce fixed column widths and gaps rather than introducing horizontal scrolling.

## Logging

Opening a Team Challenge leaderboard continues to use the existing frontend correlation ID. The `team_challenge_leaderboard_opened` event now records the actual displayed column order, whether the Push column is visible, whether points scoring is active, the completed-hole count, and `holeScoreDisplayFormat: golf_score_symbols_v1`.

## Database and deployment

No database schema change is required. No migration was added. The existing `npm install -> db:migrate -> build` deployment flow remains unchanged.
