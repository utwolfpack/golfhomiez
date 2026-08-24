import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  mapInboxMessageRow,
  normalizeInboxMessagePayload,
  validateIndividualChallengeDateRange,
} from '../server/lib/inbox-service.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

test('individual challenge accepts an optional location and a date range up to one month', () => {
  const payload = normalizeInboxMessagePayload({
    messageType: 'individual_challenge',
    body: 'Play anytime during the challenge window.',
    individualParticipantEmails: ['golfer@example.com'],
    challengeDate: '2026-08-22',
    challengeEndDate: '2026-09-22',
    challengeState: '',
    challengeCourse: '',
    challengeTeeColor: 'blue',
  })

  assert.equal(payload.challengeDate, '2026-08-22')
  assert.equal(payload.challengeEndDate, '2026-09-22')
  assert.equal(payload.challengeState, null)
  assert.equal(payload.challengeCourse, null)
  assert.deepEqual(payload.individualParticipantEmails, ['golfer@example.com'])
})



test('individual challenge creation allows an empty optional message while replies still require message text', () => {
  const payload = normalizeInboxMessagePayload({
    messageType: 'individual_challenge',
    body: '   ',
    individualParticipantEmails: ['golfer@example.com'],
    challengeDate: '2026-08-22',
    challengeEndDate: '2026-08-30',
    challengeState: '',
    challengeCourse: '',
  })

  assert.equal(payload.body, '')
  assert.deepEqual(payload.individualParticipantEmails, ['golfer@example.com'])
  assert.throws(
    () => normalizeInboxMessagePayload({
      messageType: 'individual_challenge',
      body: '',
      replyToMessageId: 'message-1',
    }),
    /Message is required/i,
  )
})

test('individual challenge rejects date ranges longer than one month', () => {
  assert.throws(
    () => validateIndividualChallengeDateRange('2026-08-22', '2026-09-23'),
    /cannot exceed one month/i,
  )
})

test('individual challenge end date maps from database rows', () => {
  const mapped = mapInboxMessageRow({
    id: 'message-1',
    thread_id: 'thread-1',
    message_type: 'individual_challenge',
    sender_email: 'creator@example.com',
    recipient_email: 'golfer@example.com',
    challenge_date: '2026-08-22',
    challenge_end_date: '2026-09-10',
    message_body: 'Challenge',
  })
  assert.equal(mapped.challengeEndDate, '2026-09-10')
})

test('challenge UI implements profile state defaults, optional individual location, validated members, active editing, and participant-only leaderboard', () => {
  const source = read('src/pages/Challenges.tsx')
  assert.match(source, /fetchProfile\(\)/)
  assert.match(source, /challenge_state_defaulted_from_profile/)
  assert.match(source, /Use a specific golf course \(optional\)/)
  assert.match(source, /InviteHomieModal/)
  assert.match(source, /lookupUserByEmail/)
  assert.match(source, /Send GolfHomiez invite/)
  assert.match(source, /Invited golfers/)
  assert.match(source, /Save challenge settings/)
  assert.match(source, /Team challenge game/)
  assert.match(source, /Points per hole/)
  assert.match(source, /\.filter\(\(row\) => row\.thru > 0\)/)
  assert.match(source, /!challengesComposeOpen \? \(/)
  assert.match(source, /Challenge Message \(optional\)/)
  assert.match(source, /Optional: write your Individual Challenge details/)
  assert.match(source, /: Boolean\(individualChallengeDateRangeValid && individualChallengeLocationValid && parsedIndividualParticipantEmails\.length > 0/)
  assert.doesNotMatch(source, /: Boolean\(challengeBody\.trim\(\) && individualChallengeDateRangeValid/)
})

test('challenge backend exposes active settings and individual participant APIs with correlated transaction logging', () => {
  const server = read('server/index.js')
  assert.match(server, /app\.patch\('\/api\/inbox\/messages\/:id\/challenge-settings'/)
  assert.match(server, /app\.post\('\/api\/inbox\/messages\/:id\/individual-participants'/)
  assert.match(server, /challenge_settings_update_started/)
  assert.match(server, /challenge_settings_update_succeeded/)
  assert.match(server, /individual_challenge_member_add_started/)
  assert.match(server, /individual_challenge_member_add_succeeded/)
  assert.match(server, /requestContext\(req\)/)
})



test('individual challenge participant status is refreshed when selected and registered golfers replace pending status', () => {
  const source = read('src/pages/Challenges.tsx')
  const inboxClient = read('src/lib/inbox.ts')
  const server = read('server/index.js')
  const mysqlStorage = read('server/storage/mysql.js')
  const sqliteStorage = read('server/storage/sqlite.js')
  const jsonStorage = read('server/storage/json.js')

  assert.match(source, /refreshIndividualChallengeParticipantStatuses\(initialChallenge, 'challenge_selected'\)/)
  assert.match(source, /refreshIndividualChallengeParticipants\(message\.id\)/)
  assert.match(source, /individual_challenge_participant_status_refresh_started/)
  assert.match(source, /individual_challenge_participant_status_refresh_succeeded/)
  assert.doesNotMatch(source, /GolfHomiez golfer/)
  assert.match(source, /!participant\.userId \? <span className="challengeInviteStatus challengeInviteStatus--pending">Invitation pending<\/span> : null/)
  assert.match(inboxClient, /individual-participants\/refresh/)
  assert.match(server, /app\.patch\('\/api\/inbox\/messages\/:id\/individual-participants\/refresh'/)
  assert.match(server, /splitName\(found\.name, found\.email\)/)
  assert.match(server, /transitionedToRegisteredCount/)
  assert.match(server, /individual_challenge_participant_refresh_succeeded/)
  assert.match(mysqlStorage, /updateInboxIndividualChallengeParticipants/)
  assert.match(sqliteStorage, /updateInboxIndividualChallengeParticipants/)
  assert.match(jsonStorage, /updateInboxIndividualChallengeParticipants/)
})

test('individual challenge golfer count opens participant list and leaderboard requires at least one saved hole', () => {
  const source = read('src/pages/Challenges.tsx')
  const css = read('src/index.css')

  assert.match(source, /individualChallengeParticipantCountButton/)
  assert.match(source, /openIndividualChallengeParticipants\(challengeMessage\)/)
  assert.match(source, /Individual Challenge golfers/)
  assert.match(source, /\.filter\(\(row\) => row\.thru > 0\)/)
  assert.doesNotMatch(source, /\.filter\(\(row\) => row\.score != null \|\| row\.thru > 0\)/)
  assert.match(source, /No golfers have entered a score yet\./)
  assert.match(css, /\.individualChallengeParticipantCountButton/)
})

test('challenge date migration is registered, idempotent, and remains part of npm install migrations', () => {
  const migration = read('migration_scripts/20260822_077_individual_challenge_date_range.sql')
  const registry = read('server/migrations/index.js')
  const pkg = JSON.parse(read('package.json'))
  assert.match(migration, /information_schema\.COLUMNS/i)
  assert.match(migration, /challenge_end_date DATE NULL/i)
  assert.match(registry, /version: '20260822_077'/)
  assert.match(registry, /columnExists\(db, 'inbox_messages', 'challenge_end_date'\)/)
  assert.match(pkg.scripts.postinstall, /db:migrate/)
})

test('individual challenge presentation removes membership activity labels and uses the simplified actions', () => {
  const source = read('src/pages/Challenges.tsx')
  const css = read('src/index.css')

  assert.match(source, /isIndividualChallengeInviteActivityMessage/)
  assert.match(source, /was invited to the Individual Challenge/)
  assert.match(source, /getConversationFor\(message\)\.filter\(\(item\) => !isIndividualChallengeInviteActivityMessage\(item\)\)/)
  assert.doesNotMatch(source, /<div className="small inboxConversationTitle">Individual Challenge Score<\/div>/)
  assert.match(source, /inboxScoreSectionHeader inboxScoreSectionHeader--actionsOnly/)
  assert.match(css, /\.inboxScoreSectionHeader--actionsOnly\{[\s\S]*justify-content:flex-end/)
  assert.match(source, /teamChallengeMembersLink/)
  assert.match(source, /Team Challenge golfers/)
  assert.match(source, /\{isIndividualChallengeMessage \? 'Say Something' : 'Reply'\}/)
})


test('challenge detail areas are sibling collapsed disclosures with completion results and Team Challenge member access', () => {
  const source = read('src/pages/Challenges.tsx')
  const css = read('src/index.css')

  assert.equal((source.match(/<section className="challengeDetailSection">/g) || []).length, 3)
  assert.match(source, /<span>Challenge Settings<\/span>/)
  assert.match(source, /<span>Challenge Score<\/span>/)
  assert.match(source, /<span>Challenge Discussion<\/span>/)
  assert.match(source, /expandedChallengeSections/)
  assert.match(source, /resetChallengeSections\(thread\.threadId\)/)
  assert.match(source, /challenge_section_expanded/)
  assert.match(source, /challenge_section_collapsed/)
  assert.match(source, /challengeCompletedResultLine/)
  assert.match(source, /1st place: \$\{participantDisplayName\(winner\.participant\)\}/)
  assert.match(source, /teamChallengeMembersLink/)
  assert.match(source, /setTeamChallengeMembersModal\(challengeMessage\)/)
  assert.match(source, /teamMemberDisplayName\(member\)/)
  assert.match(source, /Team member information is not available\./)
  assert.match(css, /\.challengeDetailSectionLink/)
  assert.match(css, /\.challengeCompletedResultLine/)
  assert.match(css, /\.teamChallengeMembersModal/)
})

test('solo logger defaults state from the logged-in profile and does not use nearest-device location', () => {
  const soloLogger = read('src/pages/SoloLogger.tsx')

  assert.match(soloLogger, /import \{ fetchProfile \} from '\.\.\/lib\/profile'/)
  assert.match(soloLogger, /const \[state, setState\] = useState\(''\)/)
  assert.match(soloLogger, /fetchProfile\(\)/)
  assert.match(soloLogger, /resolveProfileStateCode\(profilePrimaryState, stateOptions\)/)
  assert.match(soloLogger, /solo_profile_state_loaded/)
  assert.match(soloLogger, /solo_state_defaulted_from_profile/)
  assert.doesNotMatch(soloLogger, /enableNearestDefault/)
  assert.doesNotMatch(soloLogger, /onStateChange=\{setState\}/)
  assert.doesNotMatch(soloLogger, /Checking your device location for the closest golf course/)
})


test('individual challenge golfers choose their own course when the creator leaves course optional and leaderboard shows it', () => {
  const source = read('src/pages/Challenges.tsx')
  const client = read('src/lib/inbox.ts')
  const server = read('server/index.js')
  const mysqlStorage = read('server/storage/mysql.js')
  const jsonStorage = read('server/storage/json.js')
  const sqliteStorage = read('server/storage/sqlite.js')
  const css = read('src/index.css')

  assert.match(source, /Choose course to enter score/)
  assert.match(source, /Choose golf course/)
  assert.match(source, /Continue to scorecard/)
  assert.match(source, /updateIndividualChallengeCourse/)
  assert.match(source, /PLAYER \/ COURSE/)
  assert.match(source, /inboxLeaderboardCourseName/)
  assert.match(client, /courseId\?: string \| null/)
  assert.match(client, /courseState\?: string \| null/)
  assert.match(client, /courseName\?: string \| null/)
  assert.match(client, /individual-course/)
  assert.match(server, /app\.patch\('\/api\/inbox\/messages\/:id\/individual-course'/)
  assert.match(server, /individual_challenge_course_update_started/)
  assert.match(server, /individual_challenge_course_update_succeeded/)
  assert.match(server, /resolveGolfCourseForState\(state, courseName, courseId\)/)
  assert.match(server, /participant\?\.courseState/)
  assert.match(server, /participant\?\.courseName/)
  assert.match(mysqlStorage, /updateInboxIndividualChallengeCourse/)
  assert.match(jsonStorage, /updateInboxIndividualChallengeCourse/)
  assert.match(sqliteStorage, /updateInboxIndividualChallengeCourse/)
  assert.match(css, /\.inboxLeaderboardCourseName/)
})

test('challenge details use Exit Challenge, isolate an open section, and simplify Individual Challenge discussion copy', () => {
  const source = read('src/pages/Challenges.tsx')
  const css = read('src/index.css')

  assert.match(source, /Exit Challenge/)
  assert.doesNotMatch(source, /Close details/)
  assert.match(source, /challengeExitChallengeButton/)
  assert.match(css, /\.challengeExitChallengeButton\{[\s\S]*background:#fff1f2/)
  assert.match(source, /const activeChallengeSection: ChallengeDetailSection \| null/)
  assert.match(source, /activeChallengeSection === null \|\| activeChallengeSection === 'settings'/)
  assert.match(source, /activeChallengeSection === null \|\| activeChallengeSection === 'score'/)
  assert.match(source, /activeChallengeSection === null \|\| activeChallengeSection === 'discussion'/)
  assert.match(source, /source === 'team-challenges' && !activeChallengeSection/)
  assert.match(source, /challengeManagementActions/)
  assert.match(source, /Say something to your challenge group/)
  assert.match(source, /Smack talk your homiez/)
  assert.match(source, /!isIndividualChallengeMessage \? <div className="small">\{replyBody\.length\}\/2000 characters<\/div> : null/)
  assert.match(source, /isIndividualChallengeMessage \? 'Send' : 'Send Reply'/)
})

test('Team Challenge leaderboard uses the hole comparison layout and only shows Push for Skins - Push', () => {
  const challengesPage = read('src/pages/Challenges.tsx')
  const roundDetail = read('src/components/RoundDetailModal.tsx')
  const css = read('src/index.css')

  assert.match(challengesPage, /inboxTeamChallengeHoleLeaderboardBoard/)
  assert.match(challengesPage, /renderTeamChallengeSummaryView\(message, \{[\s\S]*showScorebar: false,[\s\S]*leaderboardMode: true,[\s\S]*onTeamSelect:/)
  assert.doesNotMatch(challengesPage, /<span>POS<\/span>[\s\S]{0,300}<span>TEAM<\/span>[\s\S]{0,300}<span>ROUND<\/span>/)
  assert.match(challengesPage, /const showPushColumn = pointSummary\.scoringType === 'skins_push'/)
  assert.match(challengesPage, /const showPointsColumn = isSkinsTeamChallenge\(pointSummary\.scoringType\)/)
  assert.match(challengesPage, /\{showPushColumn \? <span>Push<\/span> : null\}/)
  assert.match(challengesPage, /\{showPointsColumn \? <span>Points<\/span> : null\}/)
  assert.match(challengesPage, /HoleStrokeScore score=\{row\.proposerHole\?\.scoreProvided \? row\.proposerHole\.score : null\} par=\{row\.par\} compact/)
  assert.match(challengesPage, /HoleStrokeScore score=\{row\.challengedHole\?\.scoreProvided \? row\.challengedHole\.score : null\} par=\{row\.par\} compact/)
  assert.match(challengesPage, /pushColumnVisible: showPushColumn/)
  assert.match(challengesPage, /summaryViewMode: 'team_leaderboard_hole_grid'/)
  assert.match(roundDetail, /const showPushColumn = pointSummary\.scoringType === 'skins_push'/)
  assert.match(roundDetail, /\{showPushColumn \? <span>Push<\/span> : null\}/)
  assert.match(css, /\.inboxTeamChallengeSummaryTable--noPush/)
  assert.match(css, /\.inboxTeamChallengeSummaryTable--noPoints/)
  assert.match(css, /\.inboxTeamChallengeSummaryTeamHeaderButton/)
})
