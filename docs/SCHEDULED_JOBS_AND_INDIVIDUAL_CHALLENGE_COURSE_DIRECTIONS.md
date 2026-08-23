# Scheduled Jobs and Individual Challenge Course Changes

## `/golfadmin/scheduled-jobs`

The scheduled-jobs page now keeps the job data inside the device width. On narrower screens each job becomes a stacked card, long values wrap, job output wraps instead of scrolling horizontally, and the Run/Cancel and Schedule actions stay directly below the job name.

### Scrub Golf Homiez Tournaments

A scheduled job with ID `scrubGolfHomiezTournaments` and display name **Scrub Golf Homiez Tournaments** is registered with the existing scheduled-job framework. It defaults to Manual and can be assigned the same supported schedules as the other scheduled jobs through the existing Schedule action.

The job reviews `golf_course_tournaments` records where `golfhomiez_tournament_id` is populated. A row is considered local to the current database only when `golf_course_tournaments.golfhomiez_tournament_id` matches an existing `tournaments.id` in the current database. Rows whose referenced tournament does not exist in the current database are treated as GolfHomiez tournament records imported from another database and are deleted in batches. Local rows are retained.

The job writes correlated start, batch-delete, completion, failure, cancellation, and normal scheduled-job lifecycle events through the existing API/error/scheduled-job logging. The scheduled-job runner keeps the same correlation ID across the run.

No schema migration is needed for this job. `golf_course_tournaments.golfhomiez_tournament_id` and the scheduled-job tables already exist. Scheduled-job definitions are upserted by the existing scheduled-job framework, so the job becomes available after the updated application is deployed/restarted.

## Individual Challenge course selection

When an Individual Challenge creator leaves **Use a specific golf course (optional)** unchecked, each invited registered golfer can choose the state and golf course they are using before opening their challenge scorecard. The selected course is validated against the GolfHomiez golf-course catalog on the server.

Participant course information is stored on that golfer's existing entry in `individual_participants_json` as `courseId`, `courseState`, and `courseName`. The same participant JSON is synchronized across the challenge thread. No new database columns are required.

When the creator assigns a specific challenge course, the participant picker is bypassed and all golfers continue to use the creator-selected course.

The Individual Challenge leaderboard now labels the player column **PLAYER / COURSE** and displays the course used by each golfer who has saved at least one hole. The course label remains visible in the responsive mobile leaderboard layout.

The API endpoint used for participant course selection is:

`PATCH /api/inbox/messages/:id/individual-course`

The endpoint rejects completed challenges, non-participants, creator-assigned-course challenges, missing selections, and courses that do not resolve to the selected state's database catalog. Frontend and API activity uses the existing correlation-ID logging path.

## Deployment

No new migration was required for this change. Existing migrations still run through the project's existing `postinstall` chain:

`npm run cleanup:project-files && npm run db:migrate && npm run build`

No port behavior was changed. The existing environment-driven `PORT` behavior remains intact.

## Verification

Regression coverage is in:

- `test/golfhomiez-tournament-scrub.test.js`
- `test/challenge-enhancements.test.js`
- `test/dependency-security.test.js`

The scrub test verifies that a local GolfHomiez tournament row is retained while rows whose `golfhomiez_tournament_id` does not exist in the current `tournaments` table are deleted. The UI test verifies the responsive scheduled-jobs implementation. Challenge tests verify participant course selection, backend validation/storage, correlated logging, and leaderboard course display.
