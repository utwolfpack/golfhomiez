import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { decodeImageDataUrl, MAX_STORED_IMAGE_BYTES, ROUND_IMAGE_LIMIT, TOURNAMENT_IMAGE_LIMIT } from '../server/lib/user-images.js'

const projectRoot = path.resolve(process.cwd())

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('user image limits are three per round and eight per tournament', () => {
  assert.equal(ROUND_IMAGE_LIMIT, 3)
  assert.equal(TOURNAMENT_IMAGE_LIMIT, 8)
  assert.ok(MAX_STORED_IMAGE_BYTES >= 450 * 1024)
})

test('image data URL validation accepts image signatures and rejects disguised data', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
  const decoded = decodeImageDataUrl(`data:image/jpeg;base64,${jpeg.toString('base64')}`)
  assert.equal(decoded.mimeType, 'image/jpeg')
  assert.equal(decoded.extension, 'jpg')
  assert.throws(() => decodeImageDataUrl(`data:image/jpeg;base64,${Buffer.from('not-an-image').toString('base64')}`), /contents do not match/i)
})

test('migration and npm install path include the user_images schema migration', () => {
  const migration = source('migration_scripts/20260906_086_user_images.sql')
  const registry = source('server/migrations/index.js')
  const pkg = JSON.parse(source('package.json'))
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_images/i)
  assert.match(migration, /idx_user_images_entity/i)
  assert.match(registry, /20260906_086_user_images\.sql/)
  assert.match(pkg.scripts.postinstall, /db:migrate/)
})

test('picture UI includes compression, round/challenge rules, tournament viewer, and relative-to-par total', () => {
  const pictureLib = source('src/lib/user-images.ts')
  const challengeUi = source('src/pages/Challenges.tsx')
  const tournamentLine = source('src/components/TournamentManagementLineItem.tsx')
  const scorecard = source('src/components/HoleByHoleScorecard.tsx')
  const server = source('server/index.js')
  assert.match(pictureLib, /compressImageFile/)
  assert.match(challengeUi, /<PictureLibraryModal/)
  assert.match(server, /Only the golfer who created the challenge can upload pictures\./)
  assert.match(tournamentLine, /imageCount.*pictures/i)
  assert.match(scorecard, /formatRelativeToPar\(relativeToPar\)/)
  assert.doesNotMatch(scorecard.slice(scorecard.indexOf('aria-label="Round totals"'), scorecard.indexOf('aria-label="Round totals"') + 400), />Course par</i)
})

test('follow-up picture navigation, host accordion, flyer actions, and carousel behavior are wired', () => {
  const gitignore = source('.gitignore')
  const challengeUi = source('src/pages/Challenges.tsx')
  const inboxTypes = source('src/lib/inbox.ts')
  const scoresUi = source('src/pages/MyGolfScores.tsx')
  const pictureModal = source('src/components/PictureLibraryModal.tsx')
  const hostPortal = source('src/pages/HostPortal.tsx')
  const tournamentPortal = source('src/pages/TournamentPortal.tsx')
  const tournamentPictures = source('src/pages/TournamentPictures.tsx')
  const server = source('server/index.js')
  const css = source('src/index.css')

  assert.match(gitignore, /^userimages\/$/m)
  assert.doesNotMatch(gitignore, /!userimages\/\.gitkeep/)
  assert.equal(fs.existsSync(path.join(projectRoot, 'userimages', '.gitkeep')), false)

  assert.match(inboxTypes, /imageCount\?: number/)
  assert.match(server, /addInboxChallengeImageCounts/)
  assert.match(server, /USER_IMAGE_ENTITY_TYPES\.CHALLENGE, challengeThreadIds/)
  assert.match(challengeUi, /Number\(challengeMessage\.imageCount \|\| 0\) > 0/)
  assert.match(challengeUi, /inboxChallengeLineItemPicturesButton/)
  assert.match(challengeUi, /btn btnSmall btnLightBlue inboxChallengeLineItemPicturesButton/)
  assert.match(challengeUi, /setChallengePicturesViewOnly\(true\)/)
  assert.match(challengeUi, /viewOnly=\{challengePicturesViewOnly\}/)
  assert.match(challengeUi, /setChallengePicturesViewOnly\(false\); setChallengePicturesMessage\(message\)/)
  assert.match(pictureModal, /viewOnly = false/)
  assert.match(pictureModal, /!viewOnly && canUpload/)

  assert.match(scoresUi, /Number\(\(round as any\)\.imageCount \|\| 0\) > 0/)
  assert.match(scoresUi, /loggedRoundPicturesButton/)
  assert.match(scoresUi, /viewOnly onClose=/)
  assert.match(scoresUi, /challengeThreadId/)

  assert.match(hostPortal, /useState<HostPortalSection \| null>\(null\)/)
  assert.match(hostPortal, /current === section \? null : section/)
  const courseIndex = hostPortal.indexOf('>Course Calendar Events<')
  const tournamentsIndex = hostPortal.indexOf('>Tournaments<')
  const hostAccountsIndex = hostPortal.indexOf('>Golf-course Host Accounts<')
  assert.ok(courseIndex >= 0 && tournamentsIndex > courseIndex && hostAccountsIndex > tournamentsIndex)
  const tournamentsAccordionStart = hostPortal.indexOf('id="host-tournaments-accordion"')
  const createTournamentIndex = hostPortal.indexOf('data-testid="host-create-tournament-section"')
  assert.ok(tournamentsAccordionStart >= 0 && createTournamentIndex > tournamentsAccordionStart)

  assert.match(tournamentPortal, /tournamentFlyerPicturesButton/)
  assert.match(tournamentPortal, /tournamentFlyerLeaderboardButton/)
  assert.match(tournamentPortal, /\/leaderboard`/)
  assert.match(css, /\.tournamentFlyerPicturesButton[\s\S]*background:#dbeafe/)
  assert.match(css, /\.tournamentFlyerLeaderboardButton[\s\S]*background:#dcfce7/)

  assert.match(tournamentPictures, /const AUTO_ADVANCE_MS = 7000/)
  assert.match(tournamentPictures, /window\.setInterval\([\s\S]*AUTO_ADVANCE_MS/)
  assert.match(tournamentPictures, /scheduleCarouselResume/)
  assert.match(tournamentPictures, /const INACTIVITY_RESUME_MS = 15000/)
  assert.match(tournamentPictures, /inactivityMs: INACTIVITY_RESUME_MS/)
  assert.match(tournamentPictures, /carouselPaused \? 'Resume' : 'Pause'/)
  assert.match(tournamentPictures, /moveToPicture\(activeIndex - 1, 'previous'\)/)
  assert.match(tournamentPictures, /moveToPicture\(activeIndex \+ 1, 'next'\)/)
  assert.match(css, /@keyframes tournamentPictureFadeIn/)
  assert.match(css, /\.inboxChallengeLineItemStatus\{[\s\S]*border:0;[\s\S]*background:transparent/)
})
