# Hole-by-Hole Score Entry and Leaderboard Return

## Overview

The shared hole-by-hole score entry experience now uses one contextual Save button instead of Birdie, Par, Bogey, and Double-Bogey preset buttons. Tournament and challenge leaderboards opened from a hole scorecard retain the golfer's active-hole position. Selecting either the leaderboard back control or close control returns to the appropriate hole instead of exiting the score-entry flow.

## Score Save Button

`src/components/HoleByHoleScorecard.tsx` uses `getHoleScoreSavePresentation` from `src/lib/hole-scorecard.ts` to update the Save button as the stroke count changes.

| Score relative to par | Button text | Theme |
| --- | --- | --- |
| Score equals 1 | You got a Hole in One | Light gold |
| -3 | You got an Albatross | Light silver |
| -2 | You got an Eagle | Light purple |
| -1 | You got a Birdie | Light blue |
| Even par | You got a Par | Light green |
| +1 | You got a Bogey | Light red |
| +2 | You got a Double-Bogey | Light red |
| Greater than +2 | `+3`, `+4`, and so on | Light red |

A score of one always receives the Hole in One presentation, including when its relative-to-par value would otherwise qualify as Eagle or Albatross.

## Hole Indicator

The active-hole header displays the word **Hole** to the left of the numbered golf-ball indicator. The previous yellow center fill was replaced with a white fill while retaining the green GolfHomiez accent.

Styles are located in `src/index.css` under the `holeInputScoreHeader`, `holeInputGolfBallAccent`, and `holeInputSaveButton--*` selectors.

## Completed Scorecard Page Load

All application flows use the shared `HoleByHoleScorecard` component. When every available hole already has a saved score at page load, the scorecard now opens on **hole 1**. This completed-scorecard behavior takes precedence over a previously remembered leaderboard-return hole. Incomplete scorecards continue to open at a requested resume hole or the first hole without a saved score.

The My Tournaments team-score flow resolves its initial hole directly in `src/components/TournamentTeamScoreModal.tsx` when tournament scoring data is loaded. It evaluates hole numbers 1 through 18 in order and opens on the first hole whose stored score value is null or missing. Missing hole records are treated as null progression points. If all 18 holes have saved numeric score values, the modal initializes on hole 1. This page-load rule does not interfere with later leaderboard navigation; after the golfer starts interacting with the scorecard, the existing return-to-hole behavior remains in effect.

The frontend event `completed_scorecard_defaulted_to_hole_one` records the course, correlation ID, selected hole, and saved-hole numbers for troubleshooting.

## Leaderboard Return Behavior

### Tournament score entry

`src/components/TournamentTeamScoreModal.tsx`:

- Saves a changed active-hole value before opening the leaderboard.
- Remembers the active hole or advances to the next incomplete hole after a successful save.
- Returns to that hole when the leaderboard back control, close control, or overlay is selected.
- Preserves the normal Round Summary to Leaderboard back-navigation behavior.

### Team and individual challenges

`src/pages/Challenges.tsx` provides the same behavior for Team Challenge and Individual Challenge scorecards:

- The active hole is retained per challenge participant or team side.
- Pending score changes are saved before transitioning to the leaderboard.
- Back, close, and overlay actions return to the originating scorecard when the leaderboard was opened from that scorecard.
- A leaderboard opened directly from the challenge list continues to close normally because there is no originating scorecard.

## Challenge List Ordering and Selection

`src/pages/Challenges.tsx` orders challenge threads by:

1. Status: Active, Completed, then Deleted.
2. Challenge date, newest first.
3. Latest message creation time as a deterministic tie-breaker.

The existing Active, Completed, and Deleted views remain available. Selecting a challenge expands that challenge and temporarily hides every other challenge in the current view. Closing the selected challenge restores the complete sorted list. Frontend logging records whether other challenges were hidden and how many were removed from the selected view.

## Logging

Existing frontend correlation-ID logging records:

- Dynamic hole-score save outcomes and relative-to-par values.
- Scorecard-to-leaderboard transitions.
- The hole selected for return.
- Back, close, and overlay return actions.
- Pending-save failures that prevent a leaderboard transition.

These events continue to flow through the existing frontend logging endpoint and can be correlated with access and API transactions.

## Deployment

Copy the changed files into the same relative paths in the application and run the normal installation/test/build workflow. No database schema change is required, so no migration was added.

No npm dependency was added by this change.

## Validation

The application test suite includes coverage for:

- Contextual Save button labels and color classes.
- Hole in One precedence over relative-to-par labels.
- Removal of quick-score preset buttons.
- The Hole label and non-yellow golf-ball center.
- Tournament, team challenge, and individual challenge leaderboard return paths.
- Active-hole resume behavior and pending-hole saves.
- Completed scorecards reopening at hole 1.
- My Tournaments scorecards opening on the first null or missing score in hole order 1–18, with completed scorecards opening on hole 1.
- Challenge ordering by status and challenge date.
- Selected challenge isolation and full-list restoration when closed.
