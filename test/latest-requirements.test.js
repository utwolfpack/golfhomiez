import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('team challenge leaderboard restores stack rank, team drill-down, member email, and nine-hole awareness', () => {
  const challenges = read('src/pages/Challenges.tsx')
  const styles = read('src/index.css')
  assert.match(challenges, /aria-label="Team Challenge stack rank"/)
  assert.match(challenges, /team_stack_rank_selected/)
  assert.match(challenges, /openTeamLeaderboardRoundSummary\(message, row\.side\)/)
  assert.match(challenges, /<span className="small">\{member\.email \|\| 'Email not available'\}<\/span>/)
  assert.match(challenges, /getTeamChallengeDisplayHoleCount/)
  assert.match(challenges, /of \{holeNumbers\.length\} holes have scores from both teams/)
  assert.match(styles, /\.inboxTeamRankings/)
})

test('tournament builder and registration enforce a configured team size from two through four', () => {
  const fields = read('src/components/TournamentTemplateFields.tsx')
  const templates = read('src/lib/tournament-templates.ts')
  const portal = read('src/pages/TournamentPortal.tsx')
  const server = read('server/index.js')
  const rbac = read('server/lib/rbac.js')
  assert.match(fields, /Players on a team/)
  assert.match(fields, /TOURNAMENT_TEAM_SIZE_OPTIONS\.map/)
  assert.match(templates, /TOURNAMENT_TEAM_SIZE_OPTIONS = \[2, 3, 4\]/)
  assert.match(templates, /tournamentTeamSize\?: number/)
  assert.match(portal, /eligibleTeams = useMemo\(\(\) => teams\.filter/)
  assert.match(portal, /requiredTeammateCount/)
  assert.match(portal, /This tournament requires exactly \{requiredTeamSize\} players per team/)
  assert.match(server, /resolveRegistrationTeam\(pool, req\.body \|\| \{\}, req\.user, requiredTeamSize\)/)
  assert.match(server, /Tournament teams must have exactly \$\{normalizedRequiredTeamSize\} players for this tournament/)
  assert.match(rbac, /tournamentTeamSize:/)
})

test('notification groups require validated GolfHomiez users, can invite missing users, and soft-delete without deleting messages', () => {
  const inbox = read('src/pages/Inbox.tsx')
  const notifications = read('src/lib/notifications.ts')
  const service = read('server/lib/notification-service.js')
  const server = read('server/index.js')
  const migration = read('migration_scripts/20260824_078_message_group_soft_delete.sql')
  assert.match(inbox, /validateGroupMember/)
  assert.match(inbox, /lookupUserByEmail/)
  assert.match(inbox, /InviteHomieModal/)
  assert.match(inbox, /They were not added to the group/)
  assert.match(inbox, /Delete group/)
  assert.match(notifications, /deleteMessageGroup/)
  assert.match(server, /app\.delete\('\/api\/message-groups\/:id'/)
  assert.match(service, /UPDATE message_groups SET deleted_at = CURRENT_TIMESTAMP\(6\)/)
  assert.doesNotMatch(service, /DELETE FROM inbox_messages[^\n]*group/i)
  assert.match(migration, /ADD COLUMN deleted_at DATETIME\(6\) NULL/)
})

test('challenge notifications identify sender and timestamp in the shared discussion thread', () => {
  const inbox = read('src/pages/Inbox.tsx')
  assert.match(inbox, /Challenge discussion thread/)
  assert.match(inbox, /threadMessage\.senderEmail/)
  assert.match(inbox, /formatTimestamp\(threadMessage\.createdAt\)/)
})

test('home and my golf scores hide Clear filters until a score filter is active', () => {
  for (const path of ['src/pages/Home.tsx', 'src/pages/MyGolfScores.tsx']) {
    const source = read(path)
    assert.match(source, /const hasActiveScoreFilters = stateFilter !== 'all' \|\| courseFilter !== 'all' \|\| teamFilter !== 'all'/)
    assert.match(source, /\{hasActiveScoreFilters \? <button type="button" className="scoreFiltersClear"/)
  }
})

test('tournament round summary respects a persisted nine-hole scorecard', () => {
  const scoreModal = read('src/components/TournamentTeamScoreModal.tsx')
  assert.match(scoreModal, /const holeLimit = normalizedHoles\.length === 9/)
  assert.match(scoreModal, /defaultHoles\.slice\(0, holeLimit\)/)
  assert.match(scoreModal, /const holeCount = nextHoles\.length === 9 \? 9 : 18/)
})


test('team builder requires first and last name for invited golfers who are not registered yet', () => {
  const teams = read('src/pages/Teams.tsx')
  const teamUtils = read('server/lib/team-utils.js')
  const server = read('server/index.js')
  assert.match(teams, /First name for invited teammates/)
  assert.match(teams, /Last name for invited teammates/)
  assert.match(teams, /Add this golfer's first and last name before saving the team/)
  assert.match(teams, /manualNameRequired/)
  assert.doesNotMatch(teamUtils, /\|\| \(email \? email\.split\('@'\)\[0\]/)
  assert.match(server, /invited_member_first_last_name_required/)
  assert.match(server, /First name and last name are required for team members who do not have a GolfHomiez account/)
})

test('notification group builder removes missing-account draft members and keeps feedback beside group controls', () => {
  const inbox = read('src/pages/Inbox.tsx')
  const styles = read('src/index.css')
  assert.match(inbox, /current\.filter\(\(item\) => item\.id !== memberId\)/)
  assert.match(inbox, /draftLineRemoved: true/)
  assert.match(inbox, /addMemberInputCleared: true/)
  assert.match(inbox, /groupMemberFeedback/)
  assert.match(inbox, /groupBuilderFeedback/)
  assert.match(inbox, /groupFeedbackById/)
  assert.match(inbox, /They were not added to the group; add them after they register for GolfHomiez/)
  assert.match(styles, /\.messageGroupActionFeedback/)
})

test('completed tournament leaderboard exposes compact team-member names beneath team names', () => {
  const portal = read('src/pages/TournamentPortal.tsx')
  const accounts = read('src/lib/accounts.ts')
  const leaderboard = read('server/lib/tournament-final-leaderboard.js')
  const styles = read('src/index.css')
  assert.match(portal, /tournament-final-leaderboard-team-members/)
  assert.match(portal, /row\.teamMemberNames\.join\(' · '\)/)
  assert.match(accounts, /teamMemberNames\?: string\[\]/)
  assert.match(leaderboard, /normalizeTeamMemberNames/)
  assert.match(styles, /\.tournament-final-leaderboard-team-members/)
})
