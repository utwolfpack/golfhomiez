# Mobile hole-by-hole score flow resume

## Problem diagnosed

The uploaded production logs show that hole scores were being saved correctly, but mobile Safari could discard/reload the React page after GolfHomiez was backgrounded. The score-entry navigation state lived only in React component state, so it was lost even though the round itself remained persisted on the server.

For correlation ID `mtm5qtcn-q3lil578`, the Individual Challenge round for `seanoldroyd@outlook.com` at Copper Golf Club saved hole 8 at `2026-09-04T01:16:05Z` and automatically advanced to hole 9. At `2026-09-04T01:34:06Z`, the client performed a fresh auth/session startup. The user then had to expand the challenge, expand the Score section, and reopen the scorecard before hole 9 was selected from the server-persisted round. This confirms that score persistence was working and that the lost state was the client-side score-entry flow/navigation state.

The same client-only state issue applies to `/solo-logger`: selected date/state/course/tee and the active hole were React state only. A mobile page reload therefore returned the user to course setup even when saved hole progress existed on the backend.

The logs also contain `/api/rbac/me` responses that fail JSON parsing because HTML is returned. That is a separate issue and was not required to reproduce or explain this score-entry navigation failure.

## Implementation

`src/lib/score-flow-state.ts` adds user-scoped, best-effort `sessionStorage` resume state with a 12-hour TTL. It stores only the UI context necessary to reopen the current scoring flow; hole scores continue to be persisted by the existing backend score APIs.

For Challenges, the application now persists the active challenge thread, scoring target, and active hole. After the inbox/challenge data reloads, an active non-deleted/non-completed scorecard is reopened directly and its Score section/thread state is restored. Explicit Close and transitions to the leaderboard clear the automatic-resume marker; returning from the leaderboard establishes it again.

For Solo Logger, the date, state, selected course, course ID/search value, tee color, and active hole are restored before the browser paints by using `useLayoutEffect`. This allows the existing `/api/solo-round-score` lookup to immediately reload the server-persisted hole data instead of showing the choose-a-course flow. Explicit Close and Cancel Round clear the resume marker.

## Logging and correlation

The existing server logging already writes separate `logging/access.log`, `logging/api.log`, `logging/frontend.log`, and `logging/error.log` files and propagates `X-Correlation-Id` through the request lifecycle. The frontend correlation ID is stored in session storage and reused after a page reload.

This change adds frontend events for score-flow restoration/clearing and browser lifecycle diagnostics for `pageshow`, `pagehide`, and `visibilitychange`. The lifecycle events include the navigation type and use the same correlation ID, making an iOS background/reload sequence searchable across access, API, error, and frontend logs.

Useful frontend messages include:

- `challenge_score_flow_restored_after_page_reload`
- `challenge_score_flow_restore_target_missing`
- `challenge_score_flow_restore_target_invalid`
- `challenge_score_flow_cleared`
- `solo_score_flow_restored_after_page_reload`
- `solo_score_flow_cleared`
- `page_shown`, `page_hidden`, and `visibility_changed` with type `runtime.lifecycle`

## Database and migrations

No database schema change is required. The saved score data already exists in backend storage; only short-lived client navigation state was missing. Therefore no new migration script was created.

The existing deployment migration path remains unchanged: `package.json` runs `npm run db:migrate` from `postinstall` before the production build, so all existing and future registered migrations continue to run during `npm install` in other environments.

## Validation

Run:

```bash
npm test
npm run test:security
npm run build
npm audit --audit-level=high
```

The new regression coverage is in `test/latest-requirements.test.js` and verifies Challenge resume, Solo resume, clearing behavior, lifecycle diagnostics/correlation, and the existing postinstall migration runner.

No package dependency was added for this change. The repository's dependency-security tests verify the currently pinned patched dependency versions, including `brace-expansion` 5.0.9 and `nanoid` 3.3.18 in `package-lock.json`.

## Follow-up diagnosis: Ben Lomond intermittent restore and missing scores

The September 4 follow-up logs for `utwolfpack+test090226-8@gmail.com` expose two independent failure modes under the same frontend correlation ID, `mt8vye4r-2378zmk6`.

### 1. Returning from another tab/application closes the active My Golf Scores editor

The Ben Lomond round `2ae44452-4254-458d-85df-0a40a9f3378a` was opened in the full-viewport hole editor from `/my-golf-scores` at `2026-09-04T15:44:01Z`. Holes 6 and 7 were successfully persisted and the UI advanced to hole 8. At `15:45:06Z`, immediately as the browser went hidden, `auth.session:activity_ttl_refresh_started` ran and the auth provider refreshed session, profile, roles, and billing status.

The protected route previously treated `profileStatusLoading` and `billingStatusLoading` exactly like the initial authentication bootstrap. That replaced the protected page with its Loading view during every background refresh, unmounting `MyGolfScores`, `RoundDetailModal`, and the hole editor. The log then shows the My Golf Scores data-loading effects starting again before the tab became visible, which is the observed return to the My Golf Scores page instead of the active hole.

The fix has two layers:

- `ProtectedRoute` now uses only the initial `loading` flag to replace protected content. Background profile/billing refreshes retain the already-authorized page and its score-entry state while updated status is fetched.
- `AuthContext` ignores activity-TTL refresh triggers while `document.visibilityState === 'hidden'`. A refresh can still run when the browser is visible, but backgrounding no longer starts network work at the point mobile browsers are most likely to suspend the page.
- As a defensive recovery path for a genuine browser reload/OS eviction, the active My Golf Scores editor is persisted by user ID with `roundId`, scorecard side, and active hole. After `/api/scores` reloads, the matching round and full-viewport editor are reopened automatically.

### 2. A late scorecard load overwrites already-restored saved holes

The missing-score screenshot is reproduced exactly by the Canyon Hills trace. Holes 1-4 were saved successfully and the UI advanced to hole 5. After the page resumed, `solo_score_flow_restored_after_page_reload` restored hole 5. The existing-round request then returned score `600dbc17-5e97-458d-ac02-b54582743c59` with `restoredHoleCount: 4`, and `scorecard.persisted_holes.merge` logged `providedHoleNumbers: [1,2,3,4]`.

Forty-five milliseconds later, the slower scorecard/draft load completed and logged `providedCount: 0` and `providedHoleNumbers: []`. That stale asynchronous result replaced the newer React state, producing the displayed `0 OF 9 HOLES PROVIDED` even though the backend still had holes 1-4.

`HoleByHoleScorecard` now re-reconciles both the latest `persistedHoles` and the latest rendered holes immediately before an asynchronous load publishes its result. A late geometry/draft response therefore cannot erase a score that was restored or saved while that request was in flight. When this protection changes the pending result, frontend logging emits `scorecard.load:late_state_reconciled` with the before/after provided-hole lists and `preventedStaleLoadOverwrite: true`.

The My Golf Scores editor also clears its scorecard draft only after the authoritative round `PATCH /api/scores/:id` succeeds. This prevents an older draft from being replayed over the saved round during a future load.

Additional frontend diagnostic messages include:

- `auth.session:activity_ttl_refresh_skipped_hidden`
- `myGolfScores.roundEditResume:active_round_editor_restored_after_page_reload`
- `round.detail.edit.resume:round_edit_scorecard_restored_after_page_reload`
- `round.detail.edit.resume:round_edit_scorecard_resume_state_saved`
- `scorecard.load:late_state_reconciled`
- `round.detail.edit.draft:cleared_after_round_persist`

No database schema change is needed for either failure. The authoritative hole scores are already persisted in the existing score record; the fixes are client lifecycle, state reconciliation, draft cleanup, and resume-state handling.
