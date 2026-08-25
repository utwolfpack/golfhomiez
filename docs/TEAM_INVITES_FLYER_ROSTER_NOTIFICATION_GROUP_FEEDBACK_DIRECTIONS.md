# Team invites, tournament leaderboard rosters, and notification group feedback

## Team builder

When a team member email does not resolve to an existing GolfHomiez account, the registration invite flow still opens. After the invite is sent, the team builder requires the creator to enter both the golfer's first name and last name before the team can be saved. Registered golfers continue to have their names populated from the GolfHomiez user directory.

The API independently enforces this rule. For a directory-missing team member, both first and last name must be present; an email local-part is no longer accepted as a generated member name. Correlated API logging records `invited_member_first_last_name_required` validation failures without changing the existing port or deployment configuration.

## Completed tournament leaderboard / flyer

Final tournament leaderboard rows now include the unique names already stored with the tournament registration team roster. The public/completed tournament leaderboard renders those names on a compact line directly under the team name so the leaderboard remains space-efficient on desktop and mobile.

No schema change is required because tournament registrations already persist `team_members_json`.

## Notification groups

The group builder keeps validation and transaction feedback next to the controls that caused the action. If an email is not registered with GolfHomiez, the Invite Homie modal opens, the unregistered golfer is not added, and that draft member line is removed from the group-member builder. After the invite is sent, nearby feedback tells the creator to add the golfer after registration.

The same missing-account behavior applies when adding a member to an existing group: the add-member input is cleared, the invite modal opens, and nearby feedback confirms that the golfer was not added.

## Deployment

No database migration or new dependency is required for this update. Existing migrations remain managed by the project's `npm install` / `postinstall` migration flow. No application port was added or hardcoded.
