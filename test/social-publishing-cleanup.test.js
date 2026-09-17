import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(process.cwd())

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('scheduled-jobs admin removes social auto-posting controls while preserving MP4 downloads and Pexels metadata', () => {
  const page = read('src/pages/AdminScheduledJobs.tsx')
  const admin = read('src/lib/admin.ts')

  assert.match(page, /Commercial metadata/)
  assert.match(page, /Pexels:/)
  assert.match(page, /Download latest MP4/)
  assert.match(page, /scheduled_job_latest_mp4_download_clicked/)
  assert.match(page, /getCorrelationId/)
  assert.match(page, /correlationId=\$\{encodeURIComponent\(downloadCorrelationId\)\}/)
  assert.match(admin, /ScheduledJobCommercialMetadata/)
  assert.match(admin, /downloadUrl: string/)

  assert.doesNotMatch(page, /Social publishing configuration/)
  assert.doesNotMatch(page, /Retry failed social posts/)
  assert.doesNotMatch(page, /socialAutoPublishEnabled/)
  assert.doesNotMatch(page, /socialPublications/)
  assert.doesNotMatch(admin, /fetchSocialPublishingStatus/)
  assert.doesNotMatch(admin, /retrySocialPublications/)
  assert.doesNotMatch(admin, /SocialPublishingStatus/)
})

test('server removes social publishing routes, background retry worker, and publish orchestration but keeps authenticated MP4 download logging', () => {
  const server = read('server/index.js')
  const scheduledJobs = read('server/lib/scheduled-jobs.js')

  assert.doesNotMatch(server, /\/api\/admin\/social-publishing/)
  assert.doesNotMatch(server, /\/api\/social-publishing\/media/)
  assert.doesNotMatch(server, /startSocialPublicationRetryWorker/)
  assert.doesNotMatch(scheduledJobs, /publishCommercialToSocialPlatforms/)
  assert.doesNotMatch(scheduledJobs, /listSocialPublicationsForRuns/)
  assert.doesNotMatch(scheduledJobs, /socialPublishing/)
  assert.doesNotMatch(scheduledJobs, /SOCIAL_AUTO_PUBLISH/)

  assert.match(server, /app\.get\('\/api\/admin\/scheduled-jobs\/:id\/latest-output', adminMiddleware/)
  assert.match(server, /admin_scheduled_job_latest_output_download_started/)
  assert.match(server, /admin_scheduled_job_latest_output_download_completed/)
  assert.match(scheduledJobs, /downloadUrl: `\/api\/admin\/scheduled-jobs\/\$\{encodeURIComponent\(job\.id\)\}\/latest-output`/)
})

test('obsolete social publishing source modules and setup docs are deleted', () => {
  const obsoleteFiles = [
    'server/lib/social-oauth.js',
    'server/lib/social-publisher.js',
    'server/lib/social-publishing-crypto.js',
    'server/lib/social-publishing-store.js',
    'docs/SOCIAL_COMMERCIAL_PUBLISHING.md',
    'docs/SOCIAL_PUBLISHING_PATCH_INSTALL.md',
    'test/social-publishing.test.js',
  ]
  for (const relativePath of obsoleteFiles) {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), false, `${relativePath} should be removed`)
  }
})

test('environment example removes obsolete social credentials while retaining commercial generation settings', () => {
  const envExample = read('.env.example')

  assert.match(envExample, /PEXELS_API_KEY=/)
  assert.match(envExample, /COMMERCIAL_BACKGROUND_MUSIC_VOLUME=/)
  assert.doesNotMatch(envExample, /SOCIAL_AUTO_PUBLISH/)
  assert.doesNotMatch(envExample, /SOCIAL_PUBLISH_FACEBOOK/)
  assert.doesNotMatch(envExample, /FACEBOOK_PAGE_ACCESS_TOKEN/)
  assert.doesNotMatch(envExample, /INSTAGRAM_ACCESS_TOKEN/)
  assert.doesNotMatch(envExample, /LINKEDIN_ACCESS_TOKEN/)
  assert.doesNotMatch(envExample, /YOUTUBE_REFRESH_TOKEN/)
})

test('cleanup migration removes social tables and historical socialPublishing output while remaining in npm install migration flow', () => {
  const migration = read('migration_scripts/20260916_089_remove_social_publishing_implementation.sql')
  const registry = read('server/migrations/index.js')
  const pkg = JSON.parse(read('package.json'))

  assert.match(migration, /DROP TABLE IF EXISTS social_platform_connections/i)
  assert.match(migration, /DROP TABLE IF EXISTS social_publications/i)
  assert.match(migration, /JSON_REMOVE\(last_run_output_json, '\$\.socialPublishing'\)/i)
  assert.match(migration, /JSON_REMOVE\(output_json, '\$\.socialPublishing'\)/i)
  assert.match(registry, /version: '20260916_089'/)
  assert.match(registry, /20260916_089_remove_social_publishing_implementation\.sql/)
  assert.match(pkg.scripts.postinstall, /db:migrate/)
  assert.ok(pkg.scripts.postinstall.indexOf('db:migrate') < pkg.scripts.postinstall.indexOf('build'))
  assert.match(pkg.scripts.test, /test\/social-publishing-cleanup\.test\.js/)
  assert.doesNotMatch(pkg.scripts.test, /test\/social-publishing\.test\.js/)
})

test('commercial job docs no longer describe automatic social posting', () => {
  for (const relativePath of [
    'docs/CURRENT_EVENTS_COMMERCIAL_JOB.md',
    'docs/GREAT_SHOTS_COMMERCIAL_JOB.md',
    'docs/FUNNY_SHOTS_COMMERCIAL_JOB.md',
  ]) {
    const source = read(relativePath)
    assert.doesNotMatch(source, /Automated social publishing/)
    assert.doesNotMatch(source, /SOCIAL_AUTO_PUBLISH/)
  }
})
