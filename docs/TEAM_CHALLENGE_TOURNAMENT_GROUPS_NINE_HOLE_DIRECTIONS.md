# Team Challenge, Tournament Team Size, Notification Groups, and Nine-Hole Updates

## Deployment

Apply the changed files at the GolfHomiez project root. The only new schema migration is `migration_scripts/20260824_078_message_group_soft_delete.sql`. It is registered in `server/migrations/index.js`, so the existing `npm install` postinstall flow continues to run `db:migrate` before the production build.

No application port was added or hardcoded. The server continues to use the existing `PORT` environment variable.

## Team Challenge leaderboard

The Team Challenge leaderboard now starts with a two-team stack-rank table above the hole-by-hole comparison. Selecting a ranked team opens the same team-focused hole summary pattern used by Individual Challenge golfers. The Team Challenge golfers modal includes each member's email under the displayed name.

Team Challenge scorecard and points calculations now detect a nine-hole scorecard and restrict leaderboard/summary rows to holes 1-9. Eighteen-hole courses retain all 18 holes.

## Tournament players per team

Tournament builder `Tournament format` free text is replaced by a `Players on a team` selector with 2, 3, and 4 player choices. The setting is stored as `templateData.tournamentTeamSize`; legacy `tournamentFormat` values are still parsed when loading older tournaments, with a four-player fallback.

Public tournament flyers show `Players / team`. Tournament registration filters existing teams to the exact configured size. New-team registration creates exactly the required number of teammate fields, accounting for the signed-in golfer. The registration API independently enforces the same team-size setting.

## Notification challenge discussions

Challenge notification conversations remain threaded by challenge. Each displayed message identifies the sender and timestamp; challenge messages also show the sender email when available. Existing challenge participant authorization continues to allow all challenge participants to view the shared thread.

## Notification group validation and deletion

The group builder now validates each member email through the GolfHomiez account lookup before group creation. A missing account opens the existing Invite Homie modal with the requested email. Sending an invite does not add that address to the group; the UI tells the creator to add the golfer after registration.

Existing groups use the same account validation before adding a member.

Group owners can delete a group. Deletion is a soft delete using `message_groups.deleted_at`. The group disappears from the active Groups builder and can no longer receive messages, but its existing `inbox_messages` records are intentionally retained and remain visible in the affected users' notification history.

## Clear filters

Home and My Golf Scores only render `Clear filters` when State, Course, or Team has a non-default filter value.

## Logging

The changes extend the existing correlation-ID transaction logging with events for tournament team-size selection/enforcement, group-member validation, missing-user invite flows, group deletion, Team Challenge stack-rank selection, and tournament registration team-size checks. Existing access, API, frontend, and error log separation is unchanged.

## Verification

New regression coverage is in `test/latest-requirements.test.js`, with updates to the existing Challenge, Team Challenge scoring, tournament, and application tests. The dedicated latest-requirements test passes 6/6 and the Team Challenge scoring suite passes 4/4.
