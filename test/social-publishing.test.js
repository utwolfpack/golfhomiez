import test from 'node:test'
import process from 'node:process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  createSignedSocialMediaToken,
  verifySignedSocialMediaToken,
} from '../server/lib/social-publishing-crypto.js'
import {
  buildSignedCommercialMediaUrl,
  buildSocialCommercialCopy,
  getSocialConnectionFromEnvironment,
  getSocialPublishingConfiguration,
  SOCIAL_COMMERCIAL_JOB_IDS,
  SOCIAL_PLATFORMS,
} from '../server/lib/social-publisher.js'

const projectRoot = path.resolve(process.cwd())

function withEnv(values, fn) {
  const before = new Map(Object.keys(values).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key]
    else process.env[key] = String(value)
  }
  const restore = () => {
    for (const [key, value] of before.entries()) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
  return Promise.resolve().then(fn).finally(restore)
}

test('signed social media URLs use a dedicated secret and keep MP4 paths out of public static hosting', async () => {
  await withEnv({
    SOCIAL_MEDIA_SIGNING_SECRET: 'test-social-signing-secret',
    BETTER_AUTH_SECRET: null,
    SOCIAL_PUBLIC_BASE_URL: 'https://golfhomiez.com',
  }, () => {
    const url = buildSignedCommercialMediaUrl({ runId: 'run-1', relativePath: 'jobs/commercials/test.mp4' })
    assert.match(url, /^https:\/\/golfhomiez\.com\/api\/social-publishing\/media\//)
    const token = decodeURIComponent(url.split('/').pop())
    const parsed = verifySignedSocialMediaToken(token)
    assert.equal(parsed.runId, 'run-1')
    assert.equal(parsed.relativePath, 'jobs/commercials/test.mp4')
  })
})

test('BETTER_AUTH_SECRET is an allowed fallback for signed social media URLs', async () => {
  await withEnv({ SOCIAL_MEDIA_SIGNING_SECRET: null, BETTER_AUTH_SECRET: 'existing-app-secret' }, () => {
    const token = createSignedSocialMediaToken({ runId: 'run-2', relativePath: 'jobs/commercials/second.mp4' })
    assert.equal(verifySignedSocialMediaToken(token).runId, 'run-2')
  })
})

test('social configuration reports .env readiness without exposing credential values', async () => {
  await withEnv({
    SOCIAL_AUTO_PUBLISH: 'true',
    SOCIAL_PUBLISH_FACEBOOK: 'true',
    SOCIAL_PUBLISH_INSTAGRAM: 'true',
    SOCIAL_PUBLISH_LINKEDIN: 'true',
    SOCIAL_PUBLISH_YOUTUBE: 'true',
    FACEBOOK_PAGE_ID: '61593610114459',
    FACEBOOK_PAGE_NAME: 'Golf Homiez',
    FACEBOOK_PAGE_ACCESS_TOKEN: 'facebook-secret',
    INSTAGRAM_ACCOUNT_ID: '17841400000000000',
    INSTAGRAM_USERNAME: 'golfhomiez',
    INSTAGRAM_ACCESS_TOKEN: null,
    LINKEDIN_ORGANIZATION_ID: '143741977',
    LINKEDIN_ORGANIZATION_NAME: 'Golf Homiez',
    LINKEDIN_ACCESS_TOKEN: 'linkedin-secret',
    LINKEDIN_REFRESH_TOKEN: null,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    YOUTUBE_REFRESH_TOKEN: 'youtube-secret',
    YOUTUBE_CHANNEL_NAME: 'Golf Homiez',
  }, () => {
    const config = getSocialPublishingConfiguration()
    assert.equal(config.autoPublishEnabled, true)
    assert.equal(config.providers.facebook.configured, true)
    assert.equal(config.providers.instagram.credentialSource, 'FACEBOOK_PAGE_ACCESS_TOKEN')
    assert.equal(config.providers.linkedin.accountId, '143741977')
    assert.equal(config.providers.youtube.configured, true)
    const serialized = JSON.stringify(config)
    assert.doesNotMatch(serialized, /facebook-secret|linkedin-secret|youtube-secret|google-secret/)
  })
})

test('configuration lists actionable missing variables', async () => {
  await withEnv({
    FACEBOOK_PAGE_ID: null,
    FACEBOOK_PAGE_ACCESS_TOKEN: null,
    INSTAGRAM_ACCOUNT_ID: null,
    INSTAGRAM_ACCESS_TOKEN: null,
    LINKEDIN_ORGANIZATION_ID: null,
    LINKEDIN_ACCESS_TOKEN: null,
    LINKEDIN_REFRESH_TOKEN: null,
    LINKEDIN_CLIENT_ID: null,
    LINKEDIN_CLIENT_SECRET: null,
    GOOGLE_CLIENT_ID: null,
    GOOGLE_CLIENT_SECRET: null,
    YOUTUBE_REFRESH_TOKEN: null,
  }, () => {
    const providers = getSocialPublishingConfiguration().providers
    assert.deepEqual(providers.facebook.missing, ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN'])
    assert.match(providers.instagram.missing.join(' '), /INSTAGRAM_ACCOUNT_ID/)
    assert.match(providers.linkedin.missing.join(' '), /LINKEDIN_ACCESS_TOKEN/)
    assert.deepEqual(providers.youtube.missing, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'])
  })
})

test('Facebook, Instagram, and LinkedIn static connections are built from .env', async () => {
  await withEnv({
    SOCIAL_PUBLISH_FACEBOOK: 'true',
    SOCIAL_PUBLISH_INSTAGRAM: 'true',
    SOCIAL_PUBLISH_LINKEDIN: 'true',
    FACEBOOK_PAGE_ID: '61593610114459',
    FACEBOOK_PAGE_ACCESS_TOKEN: 'facebook-secret',
    INSTAGRAM_ACCOUNT_ID: '17841400000000000',
    INSTAGRAM_USERNAME: 'golfhomiez',
    INSTAGRAM_ACCESS_TOKEN: null,
    LINKEDIN_ORGANIZATION_ID: '143741977',
    LINKEDIN_ACCESS_TOKEN: 'linkedin-secret',
  }, async () => {
    const facebook = await getSocialConnectionFromEnvironment('facebook')
    const instagram = await getSocialConnectionFromEnvironment('instagram')
    const linkedin = await getSocialConnectionFromEnvironment('linkedin')
    assert.equal(facebook.accountId, '61593610114459')
    assert.equal(instagram.accessToken, 'facebook-secret')
    assert.equal(instagram.metadata.instagramUsername, 'golfhomiez')
    assert.equal(linkedin.accountId, '143741977')
  })
})

test('YouTube refresh token is exchanged for a temporary access token', async () => {
  await withEnv({
    SOCIAL_PUBLISH_YOUTUBE: 'true',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    YOUTUBE_REFRESH_TOKEN: 'youtube-refresh',
  }, async () => {
    let request = null
    const connection = await getSocialConnectionFromEnvironment('youtube', {
      async fetchImpl(url, options) {
        request = { url: String(url), body: String(options.body) }
        return new Response(JSON.stringify({ access_token: 'temporary-access', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    assert.equal(connection.accessToken, 'temporary-access')
    assert.equal(request.url, 'https://oauth2.googleapis.com/token')
    assert.match(request.body, /grant_type=refresh_token/)
    assert.match(request.body, /refresh_token=youtube-refresh/)
  })
})

test('all three commercial generators are eligible for all four social platforms', () => {
  assert.deepEqual([...SOCIAL_PLATFORMS], ['facebook', 'instagram', 'linkedin', 'youtube'])
  assert.equal(SOCIAL_COMMERCIAL_JOB_IDS.has('createShortFormCurrentEventsSmall'), true)
  assert.equal(SOCIAL_COMMERCIAL_JOB_IDS.has('createShortFormGreatShotsSmall'), true)
  assert.equal(SOCIAL_COMMERCIAL_JOB_IDS.has('createShortFormFunnyShotsSmall'), true)
})

test('platform copy is tailored for current events, great shots, and funny shots', () => {
  const current = buildSocialCommercialCopy({ jobId: 'createShortFormCurrentEventsSmall', jobName: 'Current Events', output: { topic: 'Solheim Cup' } })
  const great = buildSocialCommercialCopy({ jobId: 'createShortFormGreatShotsSmall', jobName: 'Great Shots', output: {} })
  const funny = buildSocialCommercialCopy({ jobId: 'createShortFormFunnyShotsSmall', jobName: 'Funny Shots', output: {} })
  assert.match(current.caption, /Solheim Cup/)
  assert.match(great.caption, /Great shot/i)
  assert.match(funny.caption, /funny shots/i)
})

test('schema migrations retain publication history and remove stored platform credentials', () => {
  const createSql = fs.readFileSync(path.join(projectRoot, 'migration_scripts/20260909_087_social_publishing.sql'), 'utf8')
  const removeSql = fs.readFileSync(path.join(projectRoot, 'migration_scripts/20260909_088_remove_social_platform_connections.sql'), 'utf8')
  assert.match(createSql, /CREATE TABLE IF NOT EXISTS social_publications/i)
  assert.match(createSql, /UNIQUE KEY uq_social_publications_run_platform \(scheduled_job_run_id, platform\)/i)
  assert.match(removeSql, /DROP TABLE IF EXISTS social_platform_connections/i)
  assert.doesNotMatch(removeSql, /DROP TABLE IF EXISTS social_publications/i)
})

test('npm install continues to run database migrations before the build', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.postinstall, /db:migrate/)
  assert.ok(pkg.scripts.postinstall.indexOf('db:migrate') < pkg.scripts.postinstall.indexOf('build'))
})

test('admin API exposes .env configuration and retry routes without OAuth connection routes', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server/index.js'), 'utf8')
  assert.match(source, /getSocialPublishingConfiguration/)
  assert.match(source, /\/api\/admin\/social-publishing\/connections/)
  assert.match(source, /\/api\/admin\/social-publishing\/publications\/:runId\/retry/)
  assert.match(source, /\/api\/social-publishing\/media\/:token/)
  assert.doesNotMatch(source, /\/api\/admin\/social-publishing\/oauth\/:provider/)
  assert.doesNotMatch(source, /connections\/:provider\/disconnect/)
})

test('Scheduled Jobs UI shows .env readiness and publication status without connect controls', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'src/pages/AdminScheduledJobs.tsx'), 'utf8')
  assert.match(source, /Social publishing configuration/)
  assert.match(source, /automatic \(\.env credentials\)/)
  assert.match(source, /Credential source/)
  assert.match(source, /Retry failed social posts/)
  assert.match(source, /View post/)
  assert.doesNotMatch(source, /social_oauth_connect_clicked/)
  assert.doesNotMatch(source, />Disconnect</)
})

test('social credentials are redacted from request and error logging', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server/lib/logger.js'), 'utf8')
  assert.match(source, /'facebook_page_access_token'/)
  assert.match(source, /'instagram_access_token'/)
  assert.match(source, /'linkedin_access_token'/)
  assert.match(source, /'linkedin_refresh_token'/)
  assert.match(source, /'youtube_refresh_token'/)
  assert.match(source, /'social_media_signing_secret'/)
  assert.match(source, /path: safeRequestUrl\(req\.originalUrl \|\| req\.url\)/)
})
