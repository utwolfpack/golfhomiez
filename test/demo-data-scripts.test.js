import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  DEMO_DATA_EMAILS,
  DEMO_HOST_COURSE_HOLES,
  DEMO_HOST_GOLF_COURSE,
  DEMO_SEED_TAG,
  TOURNAMENT_TEMPLATE_KEYS,
  TOURNAMENT_STOCK_IMAGES,
  buildDemoDataPlan,
  buildHoleDetails,
  buildSkinsPushHoleDetails,
  normalizePopulationType,
  stableDemoId,
  summarizeDemoPlan,
} from '../server/lib/demo-data-population-plan.js'
import { assertSafeExecutionOptions as assertPopulateSafeExecutionOptions, parseArgs as parsePopulateArgs } from '../server/scripts/populate-demo-data.js'
import { assertSafeExecutionOptions as assertDeleteSafeExecutionOptions, parseArgs as parseDeleteArgs } from '../server/scripts/delete-user-data.js'

const projectRoot = new URL('../', import.meta.url)

async function read(relativePath) {
  return readFile(new URL(relativePath, projectRoot), 'utf8')
}

test('demo data plan matches requested sample users and counts', () => {
  const plan = buildDemoDataPlan()
  const summary = summarizeDemoPlan(plan)

  assert.equal(DEMO_SEED_TAG, '[golfhomiez-showcase-data]')
  assert.equal(plan.emails.user, 'utwolfpack+golfhomiezuser@gmail.com')
  assert.equal(plan.emails.host, 'utwolfpack+golfhomiezhost@gmail.com')
  assert.equal(plan.emails.organizer, 'utwolfpack+golfhomiezorganizer@gmail.com')
  assert.equal(summary.user.soloRounds, 40)
  assert.equal(summary.user.teamChallenges, 15)
  assert.equal(summary.user.individualChallenges, 10)
  assert.deepEqual(summary.user.individualChallengeParticipantRange, [5, 25])
  assert.equal(summary.host.tournaments, 50)
  assert.equal(summary.host.futureTournaments, 35)
  assert.equal(summary.host.pastTournaments, 15)
  assert.equal(summary.organizer.tournaments, 10)
  assert.equal(summary.organizer.futureTournaments, 7)
  assert.equal(summary.organizer.pastTournaments, 3)
  assert.equal(summary.host.associatedOrganizerEmail, DEMO_DATA_EMAILS.organizer)
  assert.equal(summary.organizer.associatedHostEmail, DEMO_DATA_EMAILS.host)
  assert.equal(summary.host.associatedOrganizerTournamentCount, 10)
  assert.equal(summary.organizer.associatedHostTournamentCount, 10)
  assert.equal(DEMO_HOST_GOLF_COURSE.name, 'Golf Homiez Lake View')
  assert.equal(DEMO_HOST_GOLF_COURSE.stateCode, 'UT')
  assert.equal(DEMO_HOST_GOLF_COURSE.city, 'Tooele')
  assert.equal(DEMO_HOST_GOLF_COURSE.publicPageSlug, 'golfhomiezlakeviewut')
  assert.equal(DEMO_HOST_COURSE_HOLES.length, 18)
  assert.equal(plan.host.tournaments.every((tournament) => tournament.golfCourseName === DEMO_HOST_GOLF_COURSE.name), true)
  assert.equal(plan.organizer.tournaments.every((tournament) => tournament.golfCourseName === DEMO_HOST_GOLF_COURSE.name), true)

  const hostStatuses = plan.host.tournaments.map((tournament) => tournament.status)
  const organizerStatuses = plan.organizer.tournaments.map((tournament) => tournament.status)
  const userChallengeScoringTypes = plan.user.teamChallenges.map((challenge) => challenge.scoringType)
  assert.ok(userChallengeScoringTypes.includes('skins_push'))
  assert.equal(userChallengeScoringTypes.includes('points'), false)
  assert.equal(hostStatuses.filter((status) => status === 'published').length, 35)
  assert.equal(hostStatuses.filter((status) => status === 'completed').length, 15)
  assert.equal(organizerStatuses.filter((status) => status === 'published').length, 7)
  assert.equal(organizerStatuses.filter((status) => status === 'completed').length, 3)
})




test('team challenge sample data includes real skins-push holes with push values', () => {
  const plan = buildDemoDataPlan()
  const skinsPushChallenge = plan.user.teamChallenges.find((challenge) => challenge.scoringType === 'skins_push')
  assert.ok(skinsPushChallenge)
  assert.equal(skinsPushChallenge.pointsPerHole, 2)

  const proposerHoles = buildSkinsPushHoleDetails(skinsPushChallenge.proposerTotal, 18, DEMO_HOST_COURSE_HOLES, 'white', 'proposer')
  const challengedHoles = buildSkinsPushHoleDetails(skinsPushChallenge.challengedTotal, 18, DEMO_HOST_COURSE_HOLES, 'white', 'challenged')
  const pushedHoleCount = proposerHoles.filter((hole, index) => hole.score === challengedHoles[index]?.score).length
  assert.ok(pushedHoleCount >= 4)
  assert.ok(proposerHoles.every((hole) => hole.scoreProvided === true && Number(hole.par) > 0 && Number(hole.yards) > 0))
})

test('demo data stable ids fit common app UUID columns', () => {
  const id = stableDemoId('demo-auth-user', 'utwolfpack+golfhomiezhost@gmail.com')

  assert.equal(id.length, 36)
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

  const plan = buildDemoDataPlan()
  const ids = [
    stableDemoId('demo-auth-user', plan.host.email),
    stableDemoId('demo-host-account', plan.host.email),
    stableDemoId('demo-organizer-account', plan.organizer.email),
    stableDemoId('demo-role-assignment', 'host', plan.host.email),
    ...plan.user.soloRounds.map((round) => round.id),
    ...plan.user.teamChallenges.map((challenge) => challenge.id),
    ...plan.user.individualChallenges.map((challenge) => challenge.id),
    ...plan.host.tournaments.map((tournament) => tournament.id),
    ...plan.organizer.tournaments.map((tournament) => tournament.id),
  ]

  assert.ok(ids.every((value) => value.length <= 36))
  assert.equal(new Set(ids).size, ids.length)
})

test('demo data plan spans the requested dates and uses all templates/start types/image modes', () => {
  const plan = buildDemoDataPlan()
  const soloDates = plan.user.soloRounds.map((round) => round.date)

  assert.ok(Math.min(...soloDates.map((date) => Date.parse(date))) >= Date.parse('2025-01-01'))
  assert.ok(Math.max(...soloDates.map((date) => Date.parse(date))) <= Date.parse('2026-08-31'))

  for (const tournamentPlan of [plan.host.tournaments, plan.organizer.tournaments]) {
    assert.deepEqual([...new Set(tournamentPlan.map((tournament) => tournament.templateKey))].sort(), [...TOURNAMENT_TEMPLATE_KEYS].sort())
    assert.deepEqual([...new Set(tournamentPlan.map((tournament) => tournament.startType))].sort(), ['shotgun', 'tee-times'])
    assert.deepEqual([...new Set(tournamentPlan.map((tournament) => tournament.imageMode))].sort(), ['custom', 'default'])
  }
})

test('sample data avoids generated-data wording in user-visible records', () => {
  const plan = buildDemoDataPlan()
  const visibleValues = [
    ...plan.user.teamChallenges.flatMap((challenge) => [challenge.proposerTeamName, challenge.challengedTeamName]),
    ...plan.user.individualChallenges.flatMap((challenge) => challenge.participants.map((participant) => participant.name)),
    ...plan.host.tournaments.flatMap((tournament) => [tournament.name, tournament.title, tournament.description, tournament.templateData.hostOrganization, tournament.templateData.charityMessage, tournament.templateData.contactPerson, tournament.templateData.miscNotes, tournament.templateData.tournamentSummary]),
    ...plan.organizer.tournaments.flatMap((tournament) => [tournament.name, tournament.title, tournament.description, tournament.templateData.hostOrganization, tournament.templateData.charityMessage, tournament.templateData.contactPerson, tournament.templateData.miscNotes, tournament.templateData.tournamentSummary]),
  ].filter(Boolean)

  for (const value of visibleValues) {
    assert.doesNotMatch(String(value), /\bdemo\b|\bsample\b|manual-demo/i)
  }
})


test('custom tournament imagery uses external stock URLs instead of app project images', () => {
  const plan = buildDemoDataPlan()
  const customTournaments = [...plan.host.tournaments, ...plan.organizer.tournaments].filter((tournament) => tournament.imageMode === 'custom')

  assert.ok(TOURNAMENT_STOCK_IMAGES.flyerBanners.every((url) => /^https:\/\//.test(url)))
  assert.ok(TOURNAMENT_STOCK_IMAGES.beneficiaryPhotos.every((url) => /^https:\/\//.test(url)))
  assert.ok(TOURNAMENT_STOCK_IMAGES.sponsorImages.every((url) => /^https:\/\//.test(url)))
  assert.ok(customTournaments.length > 0)
  for (const tournament of customTournaments) {
    assert.match(tournament.templateBackgroundImageUrl, /^https:\/\//)
    assert.match(tournament.templateData.supportingPhotoUrl, /^https:\/\//)
    assert.ok(tournament.templateData.logoFiles.every((value) => /^https:\/\//.test(value)))
    assert.ok(tournament.templateData.sponsorImageUrls.every((value) => /^https:\/\//.test(value)))
    assert.doesNotMatch(String(tournament.templateBackgroundImageUrl), /^\/tournament-templates\//)
    assert.doesNotMatch(String(tournament.templateData.supportingPhotoUrl), /^\/tournament-templates\//)
  }
})

test('demo data tournament template bullets are stored one item per row and hole details include course metadata', () => {
  const plan = buildDemoDataPlan()
  const tournament = plan.host.tournaments[0]
  const holes = buildHoleDetails(74, 18, DEMO_HOST_COURSE_HOLES, 'white')

  assert.match(tournament.templateData.feesInclude, /Green fee and cart\nRange balls\nLive GolfHomiez scoring/)
  assert.match(tournament.templateData.prizeDetails, /Closest to the pin\nLong drive\nSkins game/)
  assert.match(tournament.templateData.holeContestsExtras, /Putting contest\nRaffle prizes|Mulligan package\nLongest putt/)
  assert.equal(holes.length, 18)
  assert.equal(holes.every((hole) => Number(hole.par) > 0 && Number(hole.yards) > 0 && hole.scoreProvided === true), true)
})


test('population script creates tournament registrations, start assignments, and completed scores for course pages', async () => {
  const script = await read('server/scripts/populate-demo-data.js')

  assert.match(script, /function buildTournamentRegistrationRows/)
  assert.match(script, /function buildTournamentStartAssignmentRows/)
  assert.match(script, /function buildTournamentScoreRows/)
  assert.match(script, /tournament_registrations/)
  assert.match(script, /tournament_team_start_assignments/)
  assert.match(script, /tournament_team_scores/)
  assert.match(script, /String\(tournament\.status \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'completed'/)
  assert.match(script, /populateTournamentOperationalRows/)
})

test('demo population scripts are manual-only and not part of postinstall', async () => {
  const packageJson = JSON.parse(await read('package.json'))

  assert.equal(packageJson.scripts['data:populate:user'], 'node server/scripts/populate-demo-data.js user')
  assert.equal(packageJson.scripts['data:populate:host'], 'node server/scripts/populate-demo-data.js host')
  assert.equal(packageJson.scripts['data:populate:organizer'], 'node server/scripts/populate-demo-data.js organizer')
  assert.equal(packageJson.scripts['data:populate:all'], 'node server/scripts/populate-demo-data.js all')
  assert.equal(packageJson.scripts['data:delete-user'], 'node server/scripts/delete-user-data.js')
  assert.doesNotMatch(packageJson.scripts.postinstall, /data:populate:/)
  assert.doesNotMatch(packageJson.scripts.postinstall, /data:delete-user/)
  assert.match(packageJson.scripts.postinstall, /db:migrate/)
  assert.match(packageJson.scripts.test, /test\/demo-data-scripts\.test\.js/)
})

test('demo population parser requires dry-run or confirm and supports custom emails', () => {
  const parsed = parsePopulateArgs(['all', '--dry-run', '--user-email', 'Golfer@Example.com', '--host-email', 'Host@Example.com', '--organizer-email', 'Organizer@Example.com'], {})

  assert.equal(parsed.scope, 'all')
  assert.equal(parsed.dryRun, true)
  assert.equal(parsed.userEmail, 'Golfer@Example.com')
  assert.equal(parsed.hostEmail, 'Host@Example.com')
  assert.equal(parsed.organizerEmail, 'Organizer@Example.com')
  assert.doesNotThrow(() => assertPopulateSafeExecutionOptions(parsed))
  assert.equal(normalizePopulationType('HOST'), 'host')
  assert.throws(() => normalizePopulationType('admin'), /Unsupported demo data population type/)
  assert.throws(() => assertPopulateSafeExecutionOptions(parsePopulateArgs(['user'], {})), /without --confirm/)
})

test('manual user delete parser requires an email and delete confirmation safety', () => {
  const dryRun = parseDeleteArgs(['--email', 'Target@Example.com', '--dry-run'], {})
  assert.equal(dryRun.email, 'target@example.com')
  assert.equal(dryRun.dryRun, true)
  assert.doesNotThrow(() => assertDeleteSafeExecutionOptions(dryRun))

  const confirmed = parseDeleteArgs(['--email', 'target@example.com', '--confirm'], {})
  assert.equal(confirmed.confirm, true)
  assert.doesNotThrow(() => assertDeleteSafeExecutionOptions(confirmed))

  assert.throws(() => assertDeleteSafeExecutionOptions(parseDeleteArgs(['--dry-run'], {})), /valid --email/)
  assert.throws(() => assertDeleteSafeExecutionOptions(parseDeleteArgs(['--email', 'target@example.com'], {})), /without --confirm/)
})

test('manual delete SQL exists, is not registered in automatic migrations, and documents email parameter safety', async () => {
  const sqlPath = 'migration_scripts/manual_user_delete/delete_user_by_email.sql'
  assert.equal(existsSync(new URL(sqlPath, projectRoot)), true)

  const sql = await read(sqlPath)
  const migrationsIndex = await read('server/migrations/index.js')

  assert.match(sql, /@target_user_email/)
  assert.match(sql, /@confirm_delete_user := 'NO'/)
  assert.match(sql, /manual-only/i)
  assert.match(sql, /NOT run by npm install/i)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS manual_delete_auth_users/)
  assert.match(sql, /COLLATE utf8mb4_general_ci/)
  assert.match(sql, /START TRANSACTION/)
  assert.match(sql, /COMMIT/)
  assert.doesNotMatch(migrationsIndex, /manual_user_delete\/delete_user_by_email\.sql/)
})

test('manual demo and user delete documentation lives in docs', async () => {
  const demoDocs = await read('docs/DEMO_DATA_POPULATION_DIRECTIONS.md')
  const deleteDocs = await read('docs/MANUAL_USER_DELETE_DIRECTIONS.md')

  assert.match(demoDocs, /# Manual Sample Data Population Scripts/)
  assert.match(demoDocs, /utwolfpack\+golfhomiezuser@gmail\.com/)
  assert.match(demoDocs, /40 individual golf rounds/)
  assert.match(demoDocs, /25 challenges/)
  assert.match(demoDocs, /50 host-owned tournaments/)
  assert.match(demoDocs, /35 future-dated host tournaments/)
  assert.match(demoDocs, /15 past-dated host tournaments/)
  assert.match(demoDocs, /10 organizer-owned tournaments/)
  assert.match(demoDocs, /7 future-dated organizer tournaments/)
  assert.match(demoDocs, /3 past-dated organizer tournaments/)
  assert.match(demoDocs, /Golf Homiez Lake View/)
  assert.match(demoDocs, /golfhomiezlakeviewut/)
  assert.match(demoDocs, /only uses courses read from the `golf_courses` table/)
  assert.match(demoDocs, /one item per line/)
  assert.match(demoDocs, /not part of `npm install`/)
  assert.match(demoDocs, /Host account schema compatibility/)
  assert.match(demoDocs, /logging\/api\.log/)

  assert.match(deleteDocs, /# Manual User Delete Script/)
  assert.match(deleteDocs, /npm run data:delete-user -- --email target@example.com --dry-run/)
  assert.match(deleteDocs, /migration_scripts\/manual_user_delete\/delete_user_by_email\.sql/)
  assert.match(deleteDocs, /not part of `npm install`/)
  assert.match(deleteDocs, /logging\/error\.log/)
})


test('user demo population reuses actual team ids before inserting team members and challenges', async () => {
  const script = await read('server/scripts/populate-demo-data.js')

  assert.match(script, /async function findTeamIdByName/)
  assert.match(script, /async function findTeamIdsByNames/)
  assert.match(script, /const deterministicTeamIds = teamNames\.map\(\(name\) => stableDemoId\('demo-team', name\)\)/)
  assert.match(script, /const existingTeamIds = await findTeamIdsByNames\(db, teamNames\)/)
  assert.match(script, /const teamIds = \[\.\.\.new Set\(\[\.\.\.deterministicTeamIds, \.\.\.existingTeamIds\]\)\]/)
  assert.match(script, /const teamIdByName = new Map\(\)/)
  assert.match(script, /teamIdByName\.set\(team\.name, team\.id\)/)
  assert.match(script, /team_id: id/)
  assert.match(script, /teamIdByName\.get\(challenge\.proposerTeamName\) \|\| stableDemoId\('demo-team', challenge\.proposerTeamName\)/)
  assert.match(script, /teamIdByName\.get\(challenge\.challengedTeamName\) \|\| stableDemoId\('demo-team', challenge\.challengedTeamName\)/)
})

test('host demo population fills legacy host account fields and links tournaments to role account id', async () => {
  const script = await read('server/scripts/populate-demo-data.js')

  assert.match(script, /const hostRoleAccountId = stableDemoId\('demo-host-role-account', email\)/)
  assert.match(script, /async function associateHostToDemoCourse/)
  assert.match(script, /auth_user_id: host\.id/)
  assert.match(script, /email: host\.email/)
  assert.match(script, /contact_name: hostDisplayName/)
  assert.match(script, /phone: course\.phone \|\| '801 555 0101'/)
  assert.match(script, /city: course\.city/)
  assert.match(script, /postal_code: course\.postalCode/)
  assert.match(script, /role_assignment_id: host\.roleAssignmentId/)
  assert.match(script, /return \{ \.\.\.authUser, roleAssignmentId, accountId: hostRoleAccountId, hostAccountId, hostRoleAccountId \}/)
  assert.doesNotMatch(script, /return \{ \.\.\.authUser, accountId: hostAccountId \}/)
})

test('demo population uses catalog courses for golfer data and creates searchable GolfHomiez course tournaments', async () => {
  const script = await read('server/scripts/populate-demo-data.js')

  assert.match(script, /loadAvailableGolfCoursesForUserDemo/)
  assert.match(script, /FROM golf_courses/)
  assert.match(script, /loadCourseHoleMetadata/)
  assert.match(script, /applyGolfCourseCatalogToUserPlan/)
  assert.match(script, /buildSkinsPushHoleDetails/)
  assert.match(script, /challenge\.scoringType === 'skins_push'/)
  assert.match(script, /ensureDemoGolfCourse/)
  assert.match(script, /Golf Homiez Lake View/)
  assert.match(script, /ensureDemoGolfCoursePublicPage/)
  assert.match(script, /syncDemoTournamentSearchRecord/)
  assert.match(script, /golf_course_tournaments/)
  assert.match(script, /golfhomiez_tournament_id/)
  assert.match(script, /active: published \? 1 : 0/)
})

test('organizer demo population fills compatibility display name fields', async () => {
  const script = await read('server/scripts/populate-demo-data.js')

  assert.match(script, /const organizerDisplayName = displayNameFromEmail\(email, 'Organizer'\)/)
  assert.match(script, /contact_name: organizerDisplayName/)
  assert.match(script, /display_name: organizerDisplayName/)
})

test('demo population phone values use the app input format', async () => {
  const plan = await read('server/lib/demo-data-population-plan.js')
  const script = await read('server/scripts/populate-demo-data.js')
  const docs = await read('docs/DEMO_DATA_POPULATION_DIRECTIONS.md')

  assert.match(plan, /phone: '801 555 0188'/)
  assert.match(plan, /contactPhone: '801 555 0100'/)
  assert.match(script, /phone: course\.phone \|\| '801 555 0101'/)
  assert.match(docs, /Phone values are populated in the same human-readable format expected by the application phone inputs/)
  assert.doesNotMatch(`${plan}\n${script}`, /801-555/)
})
