# Hole-by-Hole Score Entry and Leaderboard Return

## Overview

The shared `HoleByHoleScorecard` component is used by the solo, team, tournament, challenge, and round-edit score-entry flows. The hole tracker, score-button presentation, reset behavior, automatic progression, completed-round review, and correlated frontend logging are therefore implemented once and apply throughout the application.

## Score Save Button

`src/components/HoleByHoleScorecard.tsx` uses `getHoleScoreSavePresentation` from `src/lib/hole-scorecard.ts` to update the score button as the stroke count changes.

| Score relative to par | Saved text | Unsaved text | Theme |
| --- | --- | --- | --- |
| Score equals 1 | Hole in One | Hole in One – not saved | Light gold |
| -3 | Albatross | Albatross – not saved | Light silver |
| -2 | Eagle | Eagle – not saved | Light purple |
| -1 | Birdie | Birdie – not saved | Light blue |
| Even par | Par | Par – not saved | Light green |
| +1 | Bogey | Bogey – not saved | Light red |
| +2 | Double-Bogey | Double-Bogey – not saved | Light red |
| Greater than +2 | `+3`, `+4`, and so on | `+3 – not saved`, `+4 – not saved`, and so on | Light red |

A score of one always receives the Hole in One presentation, including when its relative-to-par value would otherwise qualify as Eagle or Albatross. Saved scores use the light themed background. A score that has not been persisted, including an edited score on a previously saved hole, uses a clear background with the matching themed text and border and includes `– not saved`.

## Hole Tracker and Progression

The hole circles at the bottom of the viewer use saved numeric score values as the source of truth:

- Saved hole: light green.
- Missing or reset hole: light red.
- Active hole: retains its green/red saved state and receives a blue focus ring/scale treatment so the current hole remains obvious.

After a hole is saved, the viewer advances in round order to the next hole that does not have a saved value, wrapping to an earlier missing hole when necessary. The new hole card receives a short slide/fade transition. If the scorecard was already complete before the save, review starts on hole 1 and re-saving/editing a hole advances sequentially from hole 1 to 2, 2 to 3, and so on. The final hole does not wrap back to hole 1 automatically.

`Complete round ready to log` is rendered only when every available hole in the tracker has a saved numeric score. Resetting a hole immediately returns it to the light-red missing state and keeps that hole active.

Frontend diagnostic events record the correlation ID, saved/reset hole, next hole, progression mode, transition mode, saved-hole numbers, and tracker color state. The existing `/api/client-logs` transport writes these records to `logging/frontend.log`; API/access middleware uses the same `X-Correlation-Id`, allowing related entries in `logging/access.log`, `logging/api.log`, and `logging/frontend.log` to be searched together.

## Unsaved Score Data Invariant

A hole now has a score value only after that hole is explicitly saved. Course par is metadata used to initialize the score-entry control; it is not copied into `hole.score` before save.

This rule is enforced in both the server and client scorecard normalization paths:

- Generated/default scorecards return `score: null` and `scoreProvided: false` for every unsaved hole.
- Database-backed course scorecards also return `score: null` until a golfer saves the hole.
- Payloads that contain a stale numeric score together with `scoreProvided: false` are normalized back to `score: null` and remain unsaved.
- Persisted-hole merges ignore entries explicitly marked unsaved, preventing an old/default par value from being restored as a saved score.
- The score-entry stepper may still initialize visually to the hole par so a golfer can save par quickly, but that pending input is local UI state and is not assigned to the hole record until Save is selected.

The API event `golf_course_scorecard_completed` now records `providedHoleCount`, `unsetScoreHoleCount`, `unsavedScoreValueCount`, and `scoreValuePolicy: saved_holes_only`. The frontend `scorecard.load` event records the same policy plus the saved and unsaved hole numbers. `unsavedScoreValueCount` should remain zero and gives stage/production diagnostics a direct signal if an unsaved score value is introduced again.

## Hole Indicator

The active-hole header displays the word **Hole** to the left of the numbered golf-ball indicator. The previous yellow center fill was replaced with a white fill while retaining the green GolfHomiez accent.

Styles are located in `src/index.css` under the `holeInputScoreHeader`, `holeInputGolfBallAccent`, and `holeInputSaveButton--*` selectors.

## Completed Scorecard Page Load

All application flows use the shared `HoleByHoleScorecard` component. When every available hole already has a saved score at page load, the scorecard now opens on **hole 1**. This completed-scorecard behavior takes precedence over a previously remembered leaderboard-return hole. Incomplete scorecards continue to open at a requested resume hole or the first hole without a saved score.

The My Tournaments team-score flow resolves its initial hole directly in `src/components/TournamentTeamScoreModal.tsx` when tournament scoring data is loaded. It evaluates hole numbers 1 through 18 in order and opens on the first hole whose stored score value is null or missing. Missing hole records are treated as null progression points. If all 18 holes have saved numeric score values, the modal initializes on hole 1. This page-load rule does not interfere with later leaderboard navigation; after the golfer starts interacting with the scorecard, the existing return-to-hole behavior remains in effect.

The frontend event `completed_scorecard_defaulted_to_hole_one` records the course, correlation ID, selected hole, and saved-hole numbers for troubleshooting.

## Stable Initial-Hole Selection

The active hole is initialized once for each scorecard context. A remembered leaderboard-return hole is read as an initialization input, while active-hole changes are reported back to the parent only for later navigation. The reported active hole is not included in the initialization key, preventing a parent/child feedback loop that could repeatedly switch the view between two holes.

The initial selection runs in a layout effect and the state also uses a lazy initial value, preventing the scorecard from briefly rendering hole 1 before moving to the actual first incomplete hole. Updates that merge persisted server scores preserve the hole the golfer is currently viewing instead of recalculating and changing the active hole.

Saved progression is determined by a valid stored numeric `score` that is not explicitly marked unsaved. A null or missing score is incomplete, and `scoreProvided: false` always keeps the hole incomplete even if an older payload also contains a stale numeric value. Legacy records without a `scoreProvided` field remain compatible: a valid numeric score is treated as saved. This same rule is used by tournament, challenge, and round-edit scorecards when deciding whether course data must be loaded and which hole should open first.

Relevant diagnostic events include:

- `scorecard.hole.default_selection`, with `selectionMode: initialize_once_per_scorecard_context`.
- `scorecard.persisted_holes.merge`, with `navigationPreserved: true`.

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

No npm dependency was added by this change. The existing package security pins/overrides are unchanged, so this UI work does not introduce a new dependency audit path.

## Validation

The application test suite includes coverage for:

- Saved versus unsaved score-button labels, clear/filled themes, and outcome-specific color classes.
- Hole in One precedence over relative-to-par labels.
- Removal of quick-score preset buttons.
- The Hole label and non-yellow golf-ball center.
- Tournament, team challenge, and individual challenge leaderboard return paths.
- Active-hole resume behavior and pending-hole saves.
- Completed scorecards reopening at hole 1 and advancing sequentially during completed-round review.
- My Tournaments scorecards opening on the first null or missing score in hole order 1–18, with completed scorecards opening on hole 1.
- Prevention of active-hole/resume-hole feedback loops that could rotate between holes.
- Persisted-score merges preserving the currently displayed hole.
- Unsaved holes keeping `score: null` across generated, database-backed, server-normalized, and client-normalized scorecards.
- Explicit `scoreProvided: false` preventing stale/default numeric values from being treated as saved, including tracker green/red state and reset-to-red behavior.
- Challenge ordering by status and challenge date.
- Selected challenge isolation and full-list restoration when closed.

## Reliable Hole Selection on Mobile

The shared scorecard now tracks the selected hole by its actual hole number rather than by the array position of the hole record. This prevents reordered or partially refreshed score data from leaving the golfer on the wrong hole.

Selecting a hole circle changes the visible hole immediately. If the previous hole has an unsaved score adjustment, persistence starts without blocking navigation. A slow or failed API request no longer traps the golfer on the prior hole; the local score remains available and the page displays an instruction to return to that hole and retry the save.

The tracker buttons use larger mobile tap targets and `touch-action: manipulation` to make hole selection reliable on touch devices. Correlated frontend events include `selected_immediately` and `previous_hole_save_failed_navigation_preserved`, with the source hole, destination hole, and navigation behavior.
