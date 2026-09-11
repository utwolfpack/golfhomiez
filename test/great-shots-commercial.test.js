import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { Buffer } from 'node:buffer'
import { setImmediate } from 'node:timers'
import {
  GREAT_SHOTS_COMMERCIAL_DURATION_SECONDS,
  GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS,
  GREAT_SHOTS_COMMERCIAL_FILE_TAG,
  GREAT_SHOTS_COMMERCIAL_JOB_ID,
  GREAT_SHOTS_COMMERCIAL_JOB_NAME,
  buildGreatShotsCommercialOutputPath,
  createGeneratedGreatShotFallbackClip,
  downloadGreatShotVideo,
  fetchGreatShotCandidates,
  greatShotsCommercialDuration,
  getGreatShotSelectionDiagnostics,
  isGreatShotVideoCandidate,
  loadPreviouslyUsedGreatShotKeys,
  parseMixkitCatalogLinks,
  parseMixkitVideoPage,
  parseFfmpegDurationText,
  parseInternetArchiveMetadataCandidate,
  parseInternetArchiveSearchResults,
  parsePexelsVideoResults,
  parsePixabayVideoResults,
  parseUsedGreatShotKeys,
  parseWikimediaCategoryMemberTitles,
  parseWikimediaVideoResults,
  reserveGreatShotsCommercialOutputPath,
  renderGreatShotsCommercial,
  resolveGreatShotsFontFile,
  runCreateShortFormGreatShotsSmall,
  selectGreatShotVideos,
} from '../server/lib/great-shots-commercial.js'
import { SCHEDULED_JOB_DEFINITIONS } from '../server/lib/scheduled-jobs.js'

function fakeSpawnWritingOutput(captured = []) {
  return (_command, args) => {
    captured.push(args)
    const child = new EventEmitter()
    child.stderr = new PassThrough()
    child.kill = () => true
    const outputPath = args.at(-1)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, Buffer.from('fake-great-shots-mp4'))
    setImmediate(() => child.emit('close', 0, null))
    return child
  }
}

function candidate({ key, provider = 'Wikimedia Commons', category, id = key, durationSeconds = 8, title = null, description = null } = {}) {
  const defaultTitle = category === 'professional'
    ? 'Professional golfer hits an incredible golf shot'
    : 'Amateur golfer hits a funny golf shot'
  return {
    key,
    provider,
    category,
    id,
    title: title || defaultTitle,
    description: description || defaultTitle,
    author: `${category} creator`,
    license: provider === 'Wikimedia Commons' ? 'CC BY 4.0' : `${provider} License`,
    licenseUrl: provider === 'Wikimedia Commons' ? 'https://creativecommons.org/licenses/by/4.0/' : null,
    sourcePageUrl: `https://example.com/${encodeURIComponent(key)}`,
    downloadUrl: `https://cdn.example.com/${encodeURIComponent(key)}.mp4`,
    durationSeconds,
    width: 1080,
    height: 1920,
  }
}

test('great-shots scheduled job has the requested identity, manual default, scheduling support, and background execution', () => {
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.id === GREAT_SHOTS_COMMERCIAL_JOB_ID)
  assert.ok(definition)
  assert.equal(definition.name, 'Create Short-form Great Shots - Small')
  assert.equal(definition.name, GREAT_SHOTS_COMMERCIAL_JOB_NAME)
  assert.deepEqual(definition.defaultSchedule, { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null })
  assert.equal(definition.backgroundManualRun, true)
  assert.equal(typeof definition.run, 'function')
})

test('great-shots output filename includes job name, GreatShotShort, date, and thirty-second maximum', () => {
  const output = buildGreatShotsCommercialOutputPath({
    now: new Date('2026-09-08T20:00:00.000Z'),
    projectRoot: '/srv/golfhomiez',
  })
  assert.equal(
    output,
    path.join('/srv/golfhomiez', 'jobs', 'commercials', `${GREAT_SHOTS_COMMERCIAL_JOB_NAME} - ${GREAT_SHOTS_COMMERCIAL_FILE_TAG} - 2026-09-08.mp4`),
  )
  assert.equal(GREAT_SHOTS_COMMERCIAL_DURATION_SECONDS, 30)
  assert.equal(GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS, 30)
})

test('great-shots output reservation increments instead of overwriting existing commercials', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-output-'))
  try {
    const base = buildGreatShotsCommercialOutputPath({ now: new Date('2026-09-08T20:00:00.000Z'), projectRoot: tempRoot })
    await fsp.mkdir(path.dirname(base), { recursive: true })
    await fsp.writeFile(base, 'first')
    await fsp.writeFile(base.replace(/\.mp4$/, ' - 2.mp4'), 'second')
    const reservation = await reserveGreatShotsCommercialOutputPath({ now: new Date('2026-09-08T20:00:00.000Z'), projectRoot: tempRoot })
    try {
      assert.equal(path.basename(reservation.outputPath), `${GREAT_SHOTS_COMMERCIAL_JOB_NAME} - ${GREAT_SHOTS_COMMERCIAL_FILE_TAG} - 2026-09-08 - 3.mp4`)
      assert.equal(reservation.sequence, 3)
      assert.equal(await fsp.readFile(base, 'utf8'), 'first')
      assert.equal(await fsp.readFile(base.replace(/\.mp4$/, ' - 2.mp4'), 'utf8'), 'second')
    } finally {
      await fsp.rm(reservation.lockPath, { force: true })
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})



test('Mixkit catalog parsing keeps only stock-video item pages and Free License pages become short golfer-shot candidates', () => {
  const links = parseMixkitCatalogLinks(`
    <a href="/free-stock-video/young-boy-golfing-2029/">Young boy golfing</a>
    <a href="/free-stock-video/girl-hitting-a-golf-ball-2044/">Girl hitting</a>
    <a href="/free-stock-video/golf/">Golf catalog</a>
  `)
  assert.deepEqual(links, [
    'https://mixkit.co/free-stock-video/young-boy-golfing-2029/',
    'https://mixkit.co/free-stock-video/girl-hitting-a-golf-ball-2044/',
  ])

  const candidate = parseMixkitVideoPage(`
    <html><head>
      <title>Young boy golfing - Free Stock Video</title>
      <meta name="description" content="A boy hits a golf ball and misses the hole.">
    </head><body>
      <h1>Young boy golfing</h1>
      <p>A boy hits a golf ball and misses the hole.</p>
      <p>Free Download Download this free stock video clip for commercial or personal use, under the Mixkit Stock Video Free License.</p>
      <div>Duration 0:13</div>
      <script>window.preview="https:\\/\\/assets.mixkit.co\\/videos\\/preview\\/mixkit-young-boy-golfing-2029-large.mp4"</script>
    </body></html>
  `, 'https://mixkit.co/free-stock-video/young-boy-golfing-2029/', {
    category: 'amateur',
    query: 'funny amateur golfer misses the hole',
  })
  assert.ok(candidate)
  assert.equal(candidate.provider, 'Mixkit')
  assert.equal(candidate.durationSeconds, 13)
  assert.equal(candidate.license, 'Mixkit Stock Video Free License')
  assert.equal(candidate.verifiedGolfShot, true)
  assert.match(candidate.downloadUrl, /assets\.mixkit\.co\/videos\/preview\/mixkit-young-boy-golfing-2029-large\.mp4/)
  assert.equal(isGreatShotVideoCandidate(candidate, 'amateur'), true)
})

test('Mixkit candidate parsing rejects Restricted License, over-30-second, virtual-golf, and non-person footage', () => {
  const page = 'https://mixkit.co/free-stock-video/people-playing-golf-20870/'
  const base = '<h1>People playing golf</h1><p>A man hits a golf ball.</p>'
  assert.equal(parseMixkitVideoPage(`${base}<p>Mixkit Restricted License personal use only</p><div>Duration 0:17</div>`, page), null)
  assert.equal(parseMixkitVideoPage(`${base}<p>Mixkit Stock Video Free License</p><div>Duration 0:31</div>`, page), null)
  assert.equal(parseMixkitVideoPage('<h1>Man playing golf in virtual reality</h1><p>A man uses a golf simulator.</p><p>Mixkit Stock Video Free License</p><div>Duration 0:10</div>', 'https://mixkit.co/free-stock-video/man-playing-golf-in-virtual-reality-9999/'), null)
  assert.equal(parseMixkitVideoPage('<h1>Golf ball bounce</h1><p>A golf ball bounces on a green.</p><p>Mixkit Stock Video Free License</p><div>Duration 0:09</div>', 'https://mixkit.co/free-stock-video/golf-ball-bounce-9998/'), null)
})

test('Mixkit parser does not fabricate preview URLs when the item page does not publish a direct MP4', () => {
  const candidate = parseMixkitVideoPage(`
    <h1>Young boy golfing</h1>
    <p>A boy hits a golf ball and misses the hole.</p>
    <p>Mixkit Stock Video Free License</p>
    <div>Duration 0:13</div>
  `, 'https://mixkit.co/free-stock-video/young-boy-golfing-2029/', {
    category: 'amateur',
    query: 'funny amateur golfer misses the hole',
  })
  assert.equal(candidate, null)
})

test('Pexels results create direct licensed video candidates with professional/amateur classification supplied by the search', () => {
  const results = parsePexelsVideoResults({
    videos: [{
      id: 123,
      url: 'https://www.pexels.com/video/golf-123/',
      duration: 9,
      user: { name: 'Pexels Golfer' },
      video_files: [
        { id: 1, file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://videos.pexels.com/video-123-landscape.mp4' },
        { id: 2, file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/video-123-portrait.mp4' },
        { id: 3, file_type: 'video/mp4', width: 2160, height: 3840, link: 'https://videos.pexels.com/video-123-4k.mp4' },
      ],
    }],
  }, 'professional', 'professional golfer golf swing')

  assert.equal(results.length, 1)
  assert.equal(results[0].provider, 'Pexels')
  assert.equal(results[0].category, 'professional')
  assert.equal(results[0].downloadUrl, 'https://videos.pexels.com/video-123-portrait.mp4')
  assert.equal(results[0].license, 'Pexels License')
  assert.equal(results[0].licenseUrl, 'https://www.pexels.com/license/')
  assert.match(results[0].key, /^pexels:/)
})

test('Pexels API is the primary free video source when PEXELS_API_KEY is configured', async () => {
  const previous = process.env.PEXELS_API_KEY
  process.env.PEXELS_API_KEY = 'pexels-test-key'
  const pexelsRequests = []
  const logs = []
  let nextId = 1000

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'api.pexels.com') {
      assert.equal(parsed.pathname, '/v1/videos/search')
      assert.equal(options.headers?.Authorization, 'pexels-test-key')
      assert.equal(parsed.searchParams.get('per_page'), '50')
      const query = parsed.searchParams.get('query')
      pexelsRequests.push(query)
      nextId += 1
      const slug = String(query || 'golf-shot').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      return {
        ok: true,
        status: 200,
        json: async () => ({
          videos: [{
            id: nextId,
            url: `https://www.pexels.com/video/${slug}-${nextId}/`,
            duration: 8,
            user: { name: `Creator ${nextId}`, url: `https://www.pexels.com/@creator-${nextId}` },
            video_files: [{
              id: nextId * 10,
              quality: 'hd',
              file_type: 'video/mp4',
              width: 1080,
              height: 1920,
              link: `https://videos.pexels.com/video-${nextId}.mp4`,
            }],
          }],
        }),
      }
    }
    if (parsed.hostname === 'commons.wikimedia.org') {
      if (parsed.searchParams.get('list') === 'categorymembers') {
        return { ok: true, status: 200, json: async () => ({ query: { categorymembers: [] } }) }
      }
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname === '/advancedsearch.php') {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) }
    }
    if (parsed.hostname === 'mixkit.co') {
      return { ok: true, status: 200, text: async () => '' }
    }
    throw new Error(`Unexpected Pexels-primary test URL: ${url}`)
  }

  try {
    const discovered = await fetchGreatShotCandidates({
      fetchImpl,
      logApi: (event, details) => logs.push({ event, details }),
    })
    assert.equal(pexelsRequests.length, 8)
    assert.equal(discovered.filter((item) => item.provider === 'Pexels').length, 8)
    assert.equal(logs.some((entry) => entry.event === 'great_shots_source_fetch_completed' && entry.details.provider === 'Pexels' && entry.details.candidateCount === 8), true)

    const selected = selectGreatShotVideos(discovered, new Set())
    assert.ok(selected.length >= 1)
    assert.equal(selected.every((item) => item.provider === 'Pexels'), true)
  } finally {
    if (previous === undefined) delete process.env.PEXELS_API_KEY
    else process.env.PEXELS_API_KEY = previous
  }
})

test('missing PEXELS_API_KEY skips Pexels cleanly and leaves no-key fallbacks available', async () => {
  const previous = process.env.PEXELS_API_KEY
  delete process.env.PEXELS_API_KEY
  const logs = []
  let pexelsCalls = 0
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'api.pexels.com') {
      pexelsCalls += 1
      throw new Error('Pexels must not be called without a key')
    }
    if (parsed.hostname === 'commons.wikimedia.org') {
      if (parsed.searchParams.get('list') === 'categorymembers') {
        return { ok: true, status: 200, json: async () => ({ query: { categorymembers: [] } }) }
      }
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname === '/advancedsearch.php') {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) }
    }
    if (parsed.hostname === 'mixkit.co') {
      return { ok: true, status: 200, text: async () => '' }
    }
    throw new Error(`Unexpected no-Pexels-key test URL: ${url}`)
  }

  try {
    await fetchGreatShotCandidates({
      fetchImpl,
      logApi: (event, details) => logs.push({ event, details }),
    })
    assert.equal(pexelsCalls, 0)
    assert.equal(logs.some((entry) => entry.event === 'great_shots_source_skipped' && entry.details.provider === 'Pexels' && /PEXELS_API_KEY/.test(entry.details.reason)), true)
  } finally {
    if (previous === undefined) delete process.env.PEXELS_API_KEY
    else process.env.PEXELS_API_KEY = previous
  }
})

test('invalid Pexels API authorization is recoverable and does not prevent fallback discovery', async () => {
  const previous = process.env.PEXELS_API_KEY
  process.env.PEXELS_API_KEY = 'invalid-key'
  const logs = []
  let pexelsCalls = 0
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'api.pexels.com') {
      pexelsCalls += 1
      return { ok: false, status: 401, json: async () => ({}) }
    }
    if (parsed.hostname === 'commons.wikimedia.org') {
      if (parsed.searchParams.get('list') === 'categorymembers') {
        return { ok: true, status: 200, json: async () => ({ query: { categorymembers: [] } }) }
      }
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname === '/advancedsearch.php') {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) }
    }
    if (parsed.hostname === 'mixkit.co') {
      return { ok: true, status: 200, text: async () => '' }
    }
    throw new Error(`Unexpected invalid-Pexels-key test URL: ${url}`)
  }

  try {
    const discovered = await fetchGreatShotCandidates({
      fetchImpl,
      logApi: (event, details) => logs.push({ event, details }),
    })
    assert.equal(Array.isArray(discovered), true)
    assert.equal(pexelsCalls, 1)
    assert.equal(logs.some((entry) => entry.event === 'great_shots_source_skipped' && entry.details.provider === 'Pexels' && /authorization failed/i.test(entry.details.reason)), true)
  } finally {
    if (previous === undefined) delete process.env.PEXELS_API_KEY
    else process.env.PEXELS_API_KEY = previous
  }
})

test('Pixabay results create safe direct video candidates and prefer portrait files', () => {
  const results = parsePixabayVideoResults({
    hits: [{
      id: 77,
      pageURL: 'https://pixabay.com/videos/golf-shot-77/',
      tags: 'golf, swing, fairway',
      user: 'WeekendGolfer',
      duration: 7,
      videos: {
        small: { url: 'https://cdn.pixabay.com/small.mp4', width: 720, height: 1280, size: 1000 },
        medium: { url: 'https://cdn.pixabay.com/medium.mp4', width: 1920, height: 1080, size: 2000 },
      },
    }],
  }, 'amateur', 'amateur golf swing')

  assert.equal(results.length, 1)
  assert.equal(results[0].provider, 'Pixabay')
  assert.equal(results[0].category, 'amateur')
  assert.equal(results[0].downloadUrl, 'https://cdn.pixabay.com/small.mp4')
})

test('Wikimedia parsing keeps commercial-friendly video licenses and rejects share-alike/noncommercial material', () => {
  const payload = {
    query: {
      pages: [
        {
          pageid: 1,
          title: 'File:Great pro shot.webm',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/pro.webm',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Great_pro_shot.webm',
            mime: 'video/webm',
            size: 4_000_000,
            width: 1280,
            height: 720,
            extmetadata: {
              LicenseShortName: { value: 'CC BY 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
              Artist: { value: 'Golf Creator' },
              ImageDescription: { value: 'Professional golfer hits an approach shot' },
            },
          }],
        },
        {
          pageid: 2,
          title: 'File:Share alike.webm',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/share.webm',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Share_alike.webm',
            mime: 'video/webm',
            size: 2_000_000,
            extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } },
          }],
        },
        {
          pageid: 3,
          title: 'File:Not a video.jpg',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/not-video.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Not_a_video.jpg',
            mime: 'image/jpeg',
            size: 100_000,
            extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } },
          }],
        },
      ],
    },
  }

  const results = parseWikimediaVideoResults(payload, 'professional', 'professional golf swing')
  assert.equal(results.length, 1)
  assert.equal(results[0].key, 'wikimedia-commons:1')
  assert.equal(results[0].license, 'CC BY 4.0')
  assert.equal(results[0].category, 'professional')
})

test('Wikimedia dual-licensed golf videos accept an available CC BY alternative and retain metadata duration', () => {
  const payload = {
    query: {
      pages: [{
        pageid: 41,
        title: 'File:Golf swing practice - Kanagawa - slow motion - 2023 June 13.webm',
        categories: [
          { title: 'Category:Swing (golf)' },
          { title: 'Category:GFDL' },
          { title: 'Category:CC-BY-4.0' },
        ],
        videoinfo: [{
          url: 'https://upload.wikimedia.org/golf-swing.webm',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Golf_swing_practice.webm',
          mime: 'video/webm',
          size: 6_022_699,
          width: 1920,
          height: 1080,
          commonmetadata: [{ name: 'duration', value: '13.813' }],
          extmetadata: {
            LicenseShortName: { value: 'GFDL' },
            Artist: { value: 'Golf Creator' },
            ImageDescription: { value: 'Man practicing a golf swing in slow motion' },
          },
        }],
      }],
    },
  }

  const results = parseWikimediaVideoResults(payload, 'amateur', 'golfer great golf shot', { verifiedGolfShot: true })
  assert.equal(results.length, 1)
  assert.equal(results[0].license, 'CC BY 4.0')
  assert.equal(results[0].licenseUrl, 'https://creativecommons.org/licenses/by/4.0/')
  assert.equal(results[0].durationSeconds, 13.813)
})

test('Wikimedia duration parser accepts TimedMediaHandler metadata when top-level duration is omitted', () => {
  const payload = {
    query: {
      pages: [{
        pageid: 42,
        title: 'File:Short funny golf shot.webm',
        categories: [{ title: 'Category:CC-BY-3.0' }],
        videoinfo: [{
          url: 'https://upload.wikimedia.org/short-golf.webm',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Short_funny_golf_shot.webm',
          mime: 'video/webm',
          size: 2_000_000,
          metadata: [{ name: 'playtime_seconds', value: '7.25' }],
          extmetadata: {
            LicenseShortName: { value: 'CC BY 3.0' },
            ImageDescription: { value: 'Golfer sinks a funny long putt' },
          },
        }],
      }],
    },
  }

  const results = parseWikimediaVideoResults(payload, 'amateur', 'funny golfer long putt')
  assert.equal(results.length, 1)
  assert.equal(results[0].durationSeconds, 7.25)
})

test('Internet Archive parsing accepts only explicitly free commercial licenses and a downloadable video file', () => {
  const searchResults = parseInternetArchiveSearchResults({
    response: {
      docs: [
        { identifier: 'free-golf', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' },
        { identifier: 'noncommercial-golf', licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/' },
        { identifier: 'unknown-rights-golf' },
      ],
    },
  })
  assert.deepEqual(searchResults.map((result) => result.identifier), ['free-golf', 'unknown-rights-golf'])

  const candidateResult = parseInternetArchiveMetadataCandidate({
    metadata: {
      identifier: 'free-golf',
      title: 'Weekend golfer holes a long putt',
      creator: 'Archive Golfer',
      licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
    },
    files: [
      { name: 'free-golf.mp4', format: 'MPEG4', size: '2500000', length: '12.5', width: '1080', height: '1920' },
      { name: 'free-golf_meta.xml', format: 'Metadata', size: '1000' },
    ],
  }, 'amateur', 'golf practice')

  assert.equal(candidateResult.provider, 'Internet Archive')
  assert.equal(candidateResult.key, 'internet-archive:free-golf')
  assert.equal(candidateResult.category, 'amateur')
  assert.equal(candidateResult.license, 'CC BY 4.0')
  assert.equal(candidateResult.downloadUrl, 'https://archive.org/download/free-golf/free-golf.mp4')
  assert.equal(candidateResult.sourcePageUrl, 'https://archive.org/details/free-golf')

  assert.equal(parseInternetArchiveMetadataCandidate({
    metadata: { identifier: 'restricted', licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/' },
    files: [{ name: 'restricted.mp4', format: 'MPEG4', size: '1000' }],
  }, 'professional'), null)
})



test('Wikimedia golf-category discovery accepts actual short shot videos while excluding non-video category members', async () => {
  assert.deepEqual(parseWikimediaCategoryMemberTitles({
    query: {
      categorymembers: [
        { title: 'File:Diego Garcia Long Drive Challenge (957829).webm' },
        { title: 'File:Golf course photo.jpg' },
        { title: 'Category:Swing (golf)' },
      ],
    },
  }), ['File:Diego Garcia Long Drive Challenge (957829).webm'])

  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'commons.wikimedia.org' && parsed.searchParams.get('list') === 'categorymembers') {
      const category = parsed.searchParams.get('cmtitle')
      if (category === 'Category:Videos of golf') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              categorymembers: [
                { pageid: 5001, ns: 6, title: 'File:Diego Garcia Long Drive Challenge (957829).webm' },
                { pageid: 5002, ns: 6, title: 'File:Nonchalant.webm' },
              ],
            },
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ query: { categorymembers: [] } }) }
    }
    if (parsed.hostname === 'commons.wikimedia.org' && /Diego Garcia Long Drive Challenge/.test(parsed.searchParams.get('titles') || '') && (parsed.searchParams.get('titles') || '').includes('|')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query: {
            pages: [
              {
                pageid: 5001,
                title: 'File:Diego Garcia Long Drive Challenge (957829).webm',
                categories: [{ title: 'Category:Videos of golf' }],
                videoinfo: [{
                  url: 'https://upload.wikimedia.org/diego.webm',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Diego_Garcia_Long_Drive_Challenge_(957829).webm',
                  mime: 'video/webm',
                  size: 17_700_000,
                  width: 1920,
                  height: 1080,
                  duration: 30,
                  extmetadata: {
                    LicenseShortName: { value: 'Public domain' },
                    ImageDescription: { value: 'Long drive challenge at a golf course' },
                    ObjectName: { value: 'Diego Garcia Long Drive Challenge' },
                  },
                }],
              },
              {
                pageid: 5002,
                title: 'File:Nonchalant.webm',
                categories: [{ title: 'Category:Videos of golf' }],
                videoinfo: [{
                  url: 'https://upload.wikimedia.org/nonchalant.webm',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Nonchalant.webm',
                  mime: 'video/webm',
                  size: 1_000_000,
                  width: 720,
                  height: 1280,
                  duration: 5,
                  extmetadata: {
                    LicenseShortName: { value: 'CC0' },
                    ImageDescription: { value: 'So much aura' },
                    ObjectName: { value: 'Nonchalant' },
                  },
                }],
              },
            ],
          },
        }),
      }
    }
    if (parsed.hostname === 'commons.wikimedia.org' && /Diego Garcia Long Drive Challenge/.test(parsed.searchParams.get('titles') || '')) {
      const title = parsed.searchParams.get('titles')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query: {
            pages: [{
              pageid: 5001,
              title,
              categories: [{ title: 'Category:Videos of golf' }],
              videoinfo: [{
                url: 'https://upload.wikimedia.org/diego.webm',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Diego_Garcia_Long_Drive_Challenge_(957829).webm',
                mime: 'video/webm',
                size: 17_700_000,
                width: 1920,
                height: 1080,
                duration: 30,
                extmetadata: {
                  LicenseShortName: { value: 'Public domain' },
                  ImageDescription: { value: 'Long drive challenge at a golf course' },
                  ObjectName: { value: 'Diego Garcia Long Drive Challenge' },
                },
              }],
            }],
          },
        }),
      }
    }
    if (parsed.hostname === 'commons.wikimedia.org') {
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname === '/advancedsearch.php') {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) }
    }
    throw new Error(`Unexpected category-discovery URL: ${url}`)
  }

  const discovered = await fetchGreatShotCandidates({ fetchImpl })
  const longDrive = discovered.find((item) => /Long Drive Challenge/.test(item.title))
  const nonchalant = discovered.find((item) => /Nonchalant/.test(item.title))
  assert.ok(longDrive)
  assert.equal(isGreatShotVideoCandidate(longDrive, 'amateur'), true)
  assert.ok(nonchalant)
  assert.equal(isGreatShotVideoCandidate(nonchalant, 'amateur'), false)
})

test('selection diagnostics explain whether discovery, history, duration, or content filtering exhausted the free pool', () => {
  const inputs = [
    candidate({ key: 'pro:used', category: 'professional', durationSeconds: 8 }),
    candidate({ key: 'amateur:too-long', category: 'amateur', durationSeconds: 31 }),
    candidate({ key: 'amateur:valid', category: 'amateur', durationSeconds: 7 }),
  ]
  const diagnostics = getGreatShotSelectionDiagnostics(inputs, new Set(['pro:used']))
  assert.equal(diagnostics.discoveredCount, 3)
  assert.equal(diagnostics.previouslyUsedCount, 1)
  assert.equal(diagnostics.unusedCount, 2)
  assert.equal(diagnostics.metadataDurationEligibleCount, 1)
  assert.equal(diagnostics.metadataDurationUnknownCount, 0)
  assert.equal(diagnostics.metadataTooLongCount, 1)
  assert.equal(diagnostics.eligibleProfessionalCount, 0)
  assert.equal(diagnostics.eligibleAmateurCount, 1)
})


test('Wikimedia search follows continuation pages so eligible short clips are not limited to the first 50 results', async () => {
  let sawSecondPage = false
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'commons.wikimedia.org' && parsed.searchParams.get('generator') === 'search') {
      const query = parsed.searchParams.get('gsrsearch') || ''
      const offset = parsed.searchParams.get('gsroffset')
      if (query.startsWith('professional golfer tee shot') && !offset) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ query: { pages: [] }, continue: { continue: '-||', gsroffset: 50 } }),
        }
      }
      if (query.startsWith('professional golfer tee shot') && offset === '50') {
        sawSecondPage = true
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              pages: [{
                pageid: 8801,
                title: 'File:Professional golfer great tee shot.webm',
                categories: [{ title: 'Category:CC-BY-4.0' }],
                videoinfo: [{
                  url: 'https://upload.wikimedia.org/pro-tee.webm',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Professional_golfer_great_tee_shot.webm',
                  mime: 'video/webm',
                  size: 2_000_000,
                  duration: 9,
                  extmetadata: {
                    LicenseShortName: { value: 'CC BY 4.0' },
                    LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
                    ImageDescription: { value: 'Professional golfer hits an incredible tee shot' },
                  },
                }],
              }],
            },
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'commons.wikimedia.org' && parsed.searchParams.get('list') === 'categorymembers') {
      return { ok: true, status: 200, json: async () => ({ query: { categorymembers: [] } }) }
    }
    if (parsed.hostname === 'commons.wikimedia.org') {
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname === '/advancedsearch.php') {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) }
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  const results = await fetchGreatShotCandidates({ fetchImpl })
  assert.equal(sawSecondPage, true)
  assert.equal(results.some((item) => item.key === 'wikimedia-commons:8801'), true)
})

test('free-source discovery preserves successful candidates when another Wikimedia request fails', async () => {
  let failedOnce = false
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'commons.wikimedia.org') {
      const title = parsed.searchParams.get('titles') || ''
      if (/Diego Garcia Long Drive Challenge/.test(title)) {
        if (!failedOnce) {
          failedOnce = true
          return { ok: false, status: 503, json: async () => ({}) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              pages: [{
                pageid: 7001,
                title,
                categories: [{ title: 'Category:Videos of golf' }],
                videoinfo: [{
                  url: 'https://upload.wikimedia.org/diego-7001.webm',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Diego_Garcia_Long_Drive_Challenge_(957829).webm',
                  mime: 'video/webm',
                  size: 2_000_000,
                  width: 1920,
                  height: 1080,
                  duration: 29,
                  extmetadata: {
                    LicenseShortName: { value: 'Public domain' },
                    ImageDescription: { value: 'Long drive challenge at a golf course' },
                    ObjectName: { value: 'Diego Garcia Long Drive Challenge' },
                  },
                }],
              }],
            },
          }),
        }
      }
      if (/Reinvestment---the-Cause-of-the-Yips-pone\.0082470\.s001/.test(title)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              pages: [{
                pageid: 7002,
                title,
                categories: [{ title: 'Category:Videos of golf' }],
                videoinfo: [{
                  url: 'https://upload.wikimedia.org/yips-7002.ogv',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Yips.ogv',
                  mime: 'video/ogg',
                  size: 1_000_000,
                  width: 720,
                  height: 1280,
                  duration: 3.7,
                  extmetadata: {
                    LicenseShortName: { value: 'CC BY 3.0' },
                    LicenseUrl: { value: 'https://creativecommons.org/licenses/by/3.0/' },
                    ImageDescription: { value: 'Mild yips golf shot' },
                    ObjectName: { value: 'Mild golf yips' },
                  },
                }],
              }],
            },
          }),
        }
      }
      if (parsed.searchParams.get('list') === 'categorymembers') {
        return { ok: true, status: 200, json: async () => ({ query: { categorymembers: [] } }) }
      }
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname === '/advancedsearch.php') {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) }
    }
    throw new Error(`Unexpected partial-failure URL: ${url}`)
  }

  const logs = []
  const discovered = await fetchGreatShotCandidates({
    fetchImpl,
    logApi: (event, details) => logs.push({ event, details }),
  })
  assert.ok(discovered.some((item) => /yips/i.test(`${item.title} ${item.description}`)))
  assert.ok(logs.some((entry) => entry.event === 'great_shots_discovery_request_failed'))
})

test('free zero-key discovery can produce a professional/amateur mix without paid or API-key sources', async () => {
  const oldPexels = process.env.PEXELS_API_KEY
  const oldPixabay = process.env.PIXABAY_API_KEY
  delete process.env.PEXELS_API_KEY
  delete process.env.PIXABAY_API_KEY

  const wikimediaPayload = ({ pageid, title, description, license = 'CC BY 4.0' }) => ({
    query: {
      pages: [{
        pageid,
        title,
        imageinfo: [{
          url: `https://upload.wikimedia.org/${pageid}.webm`,
          descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
          mime: 'video/webm',
          size: 2_000_000,
          width: 1080,
          height: 1920,
          extmetadata: {
            LicenseShortName: { value: license },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
            Artist: { value: 'Free Golf Creator' },
            ImageDescription: { value: description },
          },
        }],
      }],
    },
  })

  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'commons.wikimedia.org') {
      const title = parsed.searchParams.get('titles') || ''
      if (/Dustin Johnson/i.test(title)) {
        return { ok: true, status: 200, json: async () => wikimediaPayload({ pageid: 101, title, description: 'Professional golfer hits a U.S. Open tee shot' }) }
      }
      if (/Golf swing practice - Kanagawa/i.test(title)) {
        return { ok: true, status: 200, json: async () => wikimediaPayload({ pageid: 202, title, description: 'Person hits a clean golf swing in slow motion', license: 'CC BY 4.0' }) }
      }
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname === '/advancedsearch.php') {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) }
    }
    throw new Error(`Unexpected zero-key test URL: ${url}`)
  }

  try {
    const discovered = await fetchGreatShotCandidates({ fetchImpl })
    const selected = selectGreatShotVideos(discovered, new Set())
    assert.deepEqual(selected.map((video) => video.category), ['professional', 'amateur'])
    assert.deepEqual(selected.map((video) => video.provider), ['Wikimedia Commons', 'Wikimedia Commons'])
    assert.equal(new Set(selected.map((video) => video.key)).size, 2)
  } finally {
    if (oldPexels === undefined) delete process.env.PEXELS_API_KEY
    else process.env.PEXELS_API_KEY = oldPexels
    if (oldPixabay === undefined) delete process.env.PIXABAY_API_KEY
    else process.env.PIXABAY_API_KEY = oldPixabay
  }
})

test('free zero-key discovery includes a qualifying Mixkit Free License golf-shot fallback when Commons and Archive are exhausted', async () => {
  const mixkitPage = `
    <html><head>
      <title>Young boy golfing - Free Stock Video</title>
      <meta name="description" content="A boy who wears blue pants and a cap hits a ball and misses the hole.">
    </head><body>
      <h1>Young boy golfing</h1>
      <p>A boy who wears blue pants and a cap hits a ball and misses the hole.</p>
      <p>Free Download Download this free stock video clip for commercial or personal use, under the Mixkit Stock Video Free License.</p>
      <div>Duration 0:13</div>
      <script>window.preview="https:\\/\\/assets.mixkit.co\\/videos\\/preview\\/mixkit-young-boy-golfing-2029-large.mp4"</script>
    </body></html>
  `
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'commons.wikimedia.org') {
      if (parsed.searchParams.get('list') === 'categorymembers') {
        return { ok: true, status: 200, json: async () => ({ query: { categorymembers: [] } }) }
      }
      return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) }
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname === '/advancedsearch.php') {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) }
    }
    if (parsed.hostname === 'mixkit.co' && (parsed.pathname === '/free-stock-video/golf/' || parsed.pathname === '/free-stock-video/golf-swing/')) {
      return {
        ok: true,
        status: 200,
        text: async () => '<a href="/free-stock-video/young-boy-golfing-2029/">Young boy golfing</a>',
      }
    }
    if (parsed.hostname === 'mixkit.co' && parsed.pathname === '/free-stock-video/young-boy-golfing-2029/') {
      return { ok: true, status: 200, text: async () => mixkitPage }
    }
    if (parsed.hostname === 'mixkit.co') {
      return { ok: false, status: 404, text: async () => '' }
    }
    throw new Error(`Unexpected Mixkit zero-key test URL: ${url}`)
  }

  const discovered = await fetchGreatShotCandidates({ fetchImpl })
  const mixkit = discovered.find((item) => item.provider === 'Mixkit')
  assert.ok(mixkit)
  assert.equal(mixkit.durationSeconds, 13)
  assert.equal(mixkit.license, 'Mixkit Stock Video Free License')
  assert.equal(isGreatShotVideoCandidate(mixkit, 'amateur'), true)

  const selected = selectGreatShotVideos(discovered, new Set())
  assert.equal(selected.length, 1)
  assert.equal(selected[0].provider, 'Mixkit')
  assert.equal(selected[0].category, 'amateur')
})

test('Mixkit download retries alternate preview URLs instead of failing the selected clip on the first missing rendition', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-mixkit-download-'))
  try {
    const requested = []
    const logs = []
    const first = 'https://assets.mixkit.co/videos/preview/mixkit-young-boy-golfing-2029-large.mp4'
    const second = 'https://assets.mixkit.co/videos/preview/mixkit-young-boy-golfing-2029-small.mp4'
    const bytes = Buffer.from('fake-mixkit-video')
    const downloaded = await downloadGreatShotVideo({
      ...candidate({ key: 'mixkit:2029', provider: 'Mixkit', category: 'amateur', id: '2029', durationSeconds: 13 }),
      sourcePageUrl: 'https://mixkit.co/free-stock-video/young-boy-golfing-2029/',
      downloadUrl: first,
      downloadUrls: [first, second],
    }, {
      tempDir,
      fetchImpl: async (url) => {
        requested.push(url)
        if (url === first) return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'video/mp4' : String(bytes.length) },
          arrayBuffer: async () => bytes,
        }
      },
      logApi: (event, details) => logs.push({ event, details }),
    })

    assert.deepEqual(requested, [first, second])
    assert.equal(downloaded.downloadUrl, second)
    assert.equal(await fsp.readFile(downloaded.localPath, 'utf8'), 'fake-mixkit-video')
    assert.equal(logs.some((entry) => entry.event === 'great_shots_video_download_url_failed' && entry.details.downloadUrl === first), true)
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
})

test('selection prefers a professional/amateur pair but falls back to one qualifying full clip instead of failing', () => {
  const selected = selectGreatShotVideos([
    candidate({ key: 'pro:used', category: 'professional' }),
    candidate({ key: 'pro:new', category: 'professional' }),
    candidate({ key: 'amateur:new', category: 'amateur' }),
  ], new Set(['pro:used']))

  assert.deepEqual(selected.map((video) => video.key), ['pro:new', 'amateur:new'])
  assert.deepEqual(selected.map((video) => video.category), ['professional', 'amateur'])

  const single = selectGreatShotVideos([candidate({ key: 'only:pro', category: 'professional' })], new Set())
  assert.deepEqual(single.map((video) => video.key), ['only:pro'])
  assert.deepEqual(single.map((video) => video.category), ['professional'])
})


test('selection can use cross-query category evidence without selecting the same free video twice', () => {
  const flexible = {
    ...candidate({ key: 'commons:flexible', category: 'professional' }),
    categories: ['professional', 'amateur'],
  }
  const proOnly = {
    ...candidate({ key: 'commons:pro-only', category: 'professional' }),
    categories: ['professional'],
  }

  const selected = selectGreatShotVideos([flexible, proOnly], new Set())
  assert.deepEqual(selected.map((video) => video.key), ['commons:pro-only', 'commons:flexible'])
  assert.deepEqual(selected.map((video) => video.category), ['professional', 'amateur'])
  assert.equal(new Set(selected.map((video) => video.key)).size, 2)
})

test('selection rejects generic golf footage and videos over 30 seconds, then chooses a full pair within the 30-second commercial limit', () => {
  const drone = candidate({
    key: 'amateur:drone',
    category: 'amateur',
    title: 'Drone flyover of a golf course',
    description: 'Aerial drone course tour over golf fairways',
    durationSeconds: 8,
  })
  const practice = candidate({
    key: 'amateur:practice',
    category: 'amateur',
    title: 'Amateur golfer practices golf swing',
    description: 'Golfer practicing a normal swing at the range',
    durationSeconds: 8,
  })
  const tooLong = candidate({ key: 'pro:too-long', category: 'professional', durationSeconds: 31 })
  assert.equal(isGreatShotVideoCandidate(drone, 'amateur'), false)
  assert.equal(isGreatShotVideoCandidate(practice, 'amateur'), false)
  assert.equal(isGreatShotVideoCandidate(tooLong, 'professional'), false)

  const selected = selectGreatShotVideos([
    candidate({ key: 'pro:18', category: 'professional', durationSeconds: 18 }),
    candidate({ key: 'amateur:14', category: 'amateur', durationSeconds: 14 }),
    candidate({ key: 'amateur:10', category: 'amateur', durationSeconds: 10 }),
    drone,
    practice,
    tooLong,
  ], new Set())

  assert.deepEqual(selected.map((video) => video.key), ['pro:18', 'amateur:10'])
  assert.equal(greatShotsCommercialDuration(selected), 28)
  assert.throws(
    () => greatShotsCommercialDuration([
      candidate({ key: 'pro:15', category: 'professional', durationSeconds: 15 }),
      candidate({ key: 'amateur:16', category: 'amateur', durationSeconds: 16 }),
    ]),
    (error) => error?.code === 'GREAT_SHOT_COMMERCIAL_TOO_LONG',
  )
})

test('selection does not fail when two valid full clips cannot both fit under 30 seconds', () => {
  const candidates = [
    candidate({ key: 'pro:30', category: 'professional', durationSeconds: 30 }),
    candidate({ key: 'amateur:14', category: 'amateur', durationSeconds: 14 }),
  ]

  const first = selectGreatShotVideos(candidates, new Set())
  assert.deepEqual(first.map((video) => video.key), ['pro:30'])
  assert.equal(greatShotsCommercialDuration(first), 30)

  const next = selectGreatShotVideos(candidates, new Set(['history:one']))
  assert.deepEqual(next.map((video) => video.key), ['amateur:14'])
  assert.equal(greatShotsCommercialDuration(next), 14)
})

test('Wikimedia videoinfo duration and ffmpeg duration parsing support full-video length validation', () => {
  const parsed = parseWikimediaVideoResults({
    query: {
      pages: [{
        pageid: 91,
        title: 'File:Amazing golf shot.webm',
        categories: [{ title: 'Category:Golfers' }, { title: 'Category:Golf strokes' }],
        videoinfo: [{
          url: 'https://upload.wikimedia.org/amazing.webm',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Amazing_golf_shot.webm',
          mime: 'video/webm',
          size: 2_000_000,
          width: 1080,
          height: 1920,
          duration: 17.25,
          extmetadata: {
            LicenseShortName: { value: 'CC BY 4.0' },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
            Artist: { value: 'Golf Creator' },
            ImageDescription: { value: 'Professional golfer hits an incredible approach shot' },
          },
        }],
      }],
    },
  }, 'professional', 'professional golfer approach shot')

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].durationSeconds, 17.25)
  assert.deepEqual(parsed[0].pageCategories, ['Category:Golfers', 'Category:Golf strokes'])
  assert.equal(parseFfmpegDurationText('Duration: 00:00:29.84, start: 0.000000, bitrate: 1000 kb/s'), 29.84)
  assert.equal(parseFfmpegDurationText('no duration here'), null)
})

test('job rejects a downloaded source whose actual duration exceeds 30 seconds and retries another qualifying shot', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-duration-retry-'))
  const capturedArgs = []
  const rejected = []
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), Buffer.from('fake-logo'))
    const fakeVideo = Buffer.from('fake-mp4-source-video')
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'video/mp4' : name.toLowerCase() === 'content-length' ? String(fakeVideo.length) : null },
      arrayBuffer: async () => fakeVideo,
    })

    const output = await runCreateShortFormGreatShotsSmall({
      projectRoot: tempRoot,
      now: new Date('2026-09-08T20:00:00.000Z'),
      candidates: [
        candidate({ key: 'pro:a-too-long', category: 'professional', durationSeconds: null }),
        candidate({ key: 'pro:b-good', category: 'professional', durationSeconds: null }),
        candidate({ key: 'amateur:a-good', category: 'amateur', durationSeconds: null }),
      ],
      usedVideoKeys: new Set(),
      fetchImpl,
      probeDurationImpl: async (clip) => clip.key === 'pro:a-too-long' ? 31.5 : 7,
      resolveFontFileImpl: async () => path.join(tempRoot, 'test-font.ttf'),
      spawnImpl: fakeSpawnWritingOutput(capturedArgs),
      logApi: (event, details) => { if (event === 'great_shots_candidate_rejected') rejected.push(details) },
    })

    assert.deepEqual(output.videos.map((video) => video.key), ['pro:b-good', 'amateur:a-good'])
    assert.deepEqual(output.videos.map((video) => video.durationSeconds), [7, 7])
    assert.equal(output.durationSeconds, 14)
    assert.equal(rejected.some((entry) => entry.videoKey === 'pro:a-too-long' && /31\.500/.test(entry.reason)), true)
    assert.equal(capturedArgs.length, 1)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('job completes with a single full qualifying clip when the free catalog has no 30-second mixed pair', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-single-fallback-'))
  const capturedArgs = []
  const events = []
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), Buffer.from('fake-logo'))
    const fakeVideo = Buffer.from('fake-mp4-source-video')
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'video/mp4' : name.toLowerCase() === 'content-length' ? String(fakeVideo.length) : null },
      arrayBuffer: async () => fakeVideo,
    })

    const output = await runCreateShortFormGreatShotsSmall({
      projectRoot: tempRoot,
      now: new Date('2026-09-08T20:00:00.000Z'),
      candidates: [
        candidate({ key: 'pro:30', category: 'professional', durationSeconds: 30 }),
        candidate({ key: 'amateur:14', category: 'amateur', durationSeconds: 14 }),
      ],
      usedVideoKeys: new Set(),
      fetchImpl,
      probeDurationImpl: async (clip) => clip.durationSeconds,
      resolveFontFileImpl: async () => path.join(tempRoot, 'test-font.ttf'),
      spawnImpl: fakeSpawnWritingOutput(capturedArgs),
      logApi: (event) => events.push(event),
    })

    assert.equal(output.selectionMode, 'single-fallback')
    assert.deepEqual(output.videos.map((video) => video.key), ['pro:30'])
    assert.equal(output.durationSeconds, 30)
    assert.equal(capturedArgs.length, 1)
    assert.ok(events.includes('great_shots_single_fallback_selected'))
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('successful scheduled-job output history is parsed into no-reuse keys', async () => {
  const rows = [
    { output_json: JSON.stringify({ videos: [{ key: 'pexels:1' }, { key: 'wikimedia-commons:2' }] }) },
    { output_json: JSON.stringify({ videos: [{ key: 'pixabay:3' }] }) },
    { output_json: '{invalid-json' },
  ]
  const used = parseUsedGreatShotKeys(rows)
  assert.deepEqual([...used].sort(), ['pexels:1', 'pixabay:3', 'wikimedia-commons:2'])

  const calls = []
  const pool = {
    execute: async (sql, params) => {
      calls.push({ sql, params })
      return [rows]
    },
  }
  const loaded = await loadPreviouslyUsedGreatShotKeys(pool)
  assert.equal(loaded.has('pexels:1'), true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /scheduled_job_runs/)
  assert.deepEqual(calls[0].params, [GREAT_SHOTS_COMMERCIAL_JOB_ID])
})

test('great-shots job downloads full validated pro and amateur clips, renders their full duration, and records source metadata', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-run-'))
  const capturedArgs = []
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), Buffer.from('fake-logo'))

    const discovered = [
      candidate({ key: 'pro:old', category: 'professional' }),
      candidate({ key: 'pro:fresh', category: 'professional' }),
      candidate({ key: 'amateur:fresh', category: 'amateur' }),
    ]
    const pool = {
      execute: async () => [[{ output_json: JSON.stringify({ videos: [{ key: 'pro:old' }] }) }]],
    }
    const fakeVideo = Buffer.from('fake-mp4-source-video')
    const fetchImpl = async (url) => {
      assert.match(url, /^https:\/\/cdn\.example\.com\//)
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => {
            if (name.toLowerCase() === 'content-type') return 'video/mp4'
            if (name.toLowerCase() === 'content-length') return String(fakeVideo.length)
            return null
          },
        },
        arrayBuffer: async () => fakeVideo,
      }
    }

    const output = await runCreateShortFormGreatShotsSmall({
      pool,
      projectRoot: tempRoot,
      now: new Date('2026-09-08T20:00:00.000Z'),
      correlationId: 'great-shots-test-correlation',
      candidates: discovered,
      fetchImpl,
      resolveFontFileImpl: async () => path.join(tempRoot, 'test-font.ttf'),
      probeDurationImpl: async (clip) => clip.durationSeconds,
      spawnImpl: fakeSpawnWritingOutput(capturedArgs),
    })

    assert.equal(output.fileName, `${GREAT_SHOTS_COMMERCIAL_JOB_NAME} - ${GREAT_SHOTS_COMMERCIAL_FILE_TAG} - 2026-09-08.mp4`)
    assert.equal(output.relativePath, `jobs/commercials/${GREAT_SHOTS_COMMERCIAL_JOB_NAME} - ${GREAT_SHOTS_COMMERCIAL_FILE_TAG} - 2026-09-08.mp4`)
    assert.equal(output.durationSeconds, 16)
    assert.equal(output.resolution, '720x1280')
    assert.deepEqual(output.videos.map((video) => video.key), ['pro:fresh', 'amateur:fresh'])
    assert.deepEqual(output.videos.map((video) => video.category), ['professional', 'amateur'])
    assert.equal(output.videos.some((video) => video.key === 'pro:old'), false)
    assert.ok(fs.existsSync(path.join(tempRoot, output.relativePath)))
    assert.equal(capturedArgs.length, 1)
    assert.match(capturedArgs[0].join(' '), /PRO SHOT/)
    assert.match(capturedArgs[0].join(' '), /HOMIE SHOT/)
    assert.match(capturedArgs[0].join(' '), /WEEKEND LEGEND/)
    assert.match(capturedArgs[0].join(' '), /LOG IT\. CHALLENGE IT\. REPLAY IT\./)
    assert.ok(capturedArgs[0].includes('libx264'))
    assert.ok(capturedArgs[0].includes('+faststart'))
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('great-shots font resolver honors an explicit readable font without requiring fontconfig', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-font-'))
  try {
    const fontPath = path.join(tempRoot, 'commercial-font.ttf')
    await fsp.writeFile(fontPath, Buffer.from('test-font'))
    const resolved = await resolveGreatShotsFontFile({ configuredPath: fontPath, projectRoot: tempRoot })
    assert.equal(resolved, fontPath)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('great-shots renderer normalizes sample aspect ratio and uses an explicit font for every text overlay', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-render-normalize-'))
  try {
    const assetsDir = path.join(tempRoot, 'src', 'assets')
    const clipsDir = path.join(tempRoot, 'clips')
    await fsp.mkdir(assetsDir, { recursive: true })
    await fsp.mkdir(clipsDir, { recursive: true })
    await fsp.writeFile(path.join(assetsDir, 'GolfHomiezEmblem.png'), Buffer.from('fake-emblem'))
    const professionalPath = path.join(clipsDir, 'professional.mp4')
    const amateurPath = path.join(clipsDir, 'amateur.mp4')
    const fontPath = path.join(tempRoot, 'test-font.ttf')
    await Promise.all([
      fsp.writeFile(professionalPath, Buffer.from('professional')),
      fsp.writeFile(amateurPath, Buffer.from('amateur')),
      fsp.writeFile(fontPath, Buffer.from('font')),
    ])

    const capturedArgs = []
    const outputPath = path.join(tempRoot, 'jobs', 'commercials', 'normalized.mp4')
    await renderGreatShotsCommercial({
      outputPath,
      clips: [
        { ...candidate({ key: 'pro:sar', category: 'professional' }), localPath: professionalPath },
        { ...candidate({ key: 'amateur:sar', category: 'amateur' }), localPath: amateurPath },
      ],
      projectRoot: tempRoot,
      fontFile: fontPath,
      resolveFontFileImpl: async () => fontPath,
      spawnImpl: fakeSpawnWritingOutput(capturedArgs),
    })

    assert.equal(capturedArgs.length, 1)
    const args = capturedArgs[0]
    const filterComplex = args[args.indexOf('-filter_complex') + 1]
    assert.ok(filterComplex)
    assert.equal((filterComplex.match(/crop=720:1280,setsar=1,fps=30,format=yuv420p/g) || []).length, 2)
    assert.match(filterComplex, /trim=start=0:duration=8\.000/)
    assert.doesNotMatch(filterComplex, /tpad=/)
    assert.match(filterComplex, /\[2:v\]scale=142:-1,setsar=1\[logo\]/)
    assert.equal((filterComplex.match(/drawtext=fontfile=/g) || []).length, 12)
    assert.doesNotMatch(filterComplex, /drawtext=text=/)
    assert.equal(args[args.indexOf('-t') + 1], '16.000')
    assert.match(filterComplex, /volume=0\.120/)
    assert.match(filterComplex, /\[aout\]/)
    assert.equal(args.includes('-an'), false)
    assert.ok(args.includes('[aout]'))
    assert.equal(args[args.lastIndexOf('-c:a') + 1], 'aac')
    assert.ok(fs.existsSync(outputPath))
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('great-shots renderer supports a single full qualifying clip while preserving branding and SAR normalization', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-render-single-'))
  try {
    const assetsDir = path.join(tempRoot, 'src', 'assets')
    const clipsDir = path.join(tempRoot, 'clips')
    await fsp.mkdir(assetsDir, { recursive: true })
    await fsp.mkdir(clipsDir, { recursive: true })
    await fsp.writeFile(path.join(assetsDir, 'GolfHomiezEmblem.png'), Buffer.from('fake-emblem'))
    const professionalPath = path.join(clipsDir, 'professional.mp4')
    const fontPath = path.join(tempRoot, 'test-font.ttf')
    await Promise.all([
      fsp.writeFile(professionalPath, Buffer.from('professional')),
      fsp.writeFile(fontPath, Buffer.from('font')),
    ])

    const capturedArgs = []
    const outputPath = path.join(tempRoot, 'jobs', 'commercials', 'single.mp4')
    const result = await renderGreatShotsCommercial({
      outputPath,
      clips: [{ ...candidate({ key: 'pro:single', category: 'professional', durationSeconds: 12 }), localPath: professionalPath }],
      projectRoot: tempRoot,
      fontFile: fontPath,
      resolveFontFileImpl: async () => fontPath,
      spawnImpl: fakeSpawnWritingOutput(capturedArgs),
    })

    assert.equal(result.durationSeconds, 12)
    assert.equal(result.selectionMode, 'single-fallback')
    const args = capturedArgs[0]
    const filterComplex = args[args.indexOf('-filter_complex') + 1]
    assert.match(filterComplex, /\[scene0\]null\[story\]/)
    assert.match(filterComplex, /crop=720:1280,setsar=1,fps=30,format=yuv420p/)
    assert.doesNotMatch(filterComplex, /concat=n=2/)
    assert.equal(args[args.indexOf('-t') + 1], '12.000')
    assert.ok(fs.existsSync(outputPath))
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})


test('generated Great Shots fallback creates a unique local source clip without an external video provider', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-generated-fallback-'))
  try {
    const captured = []
    const clip = await createGeneratedGreatShotFallbackClip({
      tempDir: tempRoot,
      projectRoot: tempRoot,
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeSpawnWritingOutput(captured),
      durationSeconds: 8,
    })
    assert.equal(clip.provider, 'GolfHomiez')
    assert.equal(clip.generatedFallback, true)
    assert.equal(clip.durationSeconds, 8)
    assert.match(clip.key, /^golfhomiez-generated:/)
    assert.ok(fs.existsSync(clip.localPath))
    assert.equal(captured.length, 1)
    assert.match(captured[0].join(' '), /zoompan/)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('job falls back to generated GolfHomiez footage when repeated Mixkit CDN 403 responses block all free external clips', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-great-shots-mixkit-403-fallback-'))
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), Buffer.from('fake-png'))
    const font = path.join(tempRoot, 'font.ttf')
    await fsp.writeFile(font, 'fake-font')

    const mk = (id) => ({
      ...candidate({ key: `mixkit:${id}`, provider: 'Mixkit', category: 'amateur', id, durationSeconds: 10 }),
      title: 'Amateur golfer hits a funny golf shot',
      description: 'A golfer hits a funny golf shot.',
      verifiedGolfShot: true,
      license: 'Mixkit Stock Video Free License',
      sourcePageUrl: `https://mixkit.co/free-stock-video/amateur-golf-shot-${id}/`,
      downloadUrl: `https://assets.mixkit.co/videos/preview/mixkit-amateur-golf-shot-${id}-large.mp4`,
      downloadUrls: [
        `https://assets.mixkit.co/videos/preview/mixkit-amateur-golf-shot-${id}-large.mp4`,
        `https://assets.mixkit.co/videos/preview/mixkit-amateur-golf-shot-${id}-small.mp4`,
      ],
    })

    const events = []
    const output = await runCreateShortFormGreatShotsSmall({
      projectRoot: tempRoot,
      now: new Date('2026-09-09T03:00:00.000Z'),
      candidates: [mk('1001'), mk('1002'), mk('1003')],
      usedVideoKeys: new Set(),
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
      generatedFallbackImpl: async ({ tempDir }) => {
        const localPath = path.join(tempDir, 'generated-fallback.mp4')
        await fsp.writeFile(localPath, 'generated-video')
        return {
          key: 'golfhomiez-generated:test',
          provider: 'GolfHomiez',
          id: 'test',
          category: 'amateur',
          title: 'GolfHomiez generated great-shot replay',
          author: 'GolfHomiez',
          license: 'GolfHomiez generated media',
          sourcePageUrl: 'https://golfhomiez.com',
          durationSeconds: 8,
          localPath,
          generatedFallback: true,
        }
      },
      resolveFontFileImpl: async () => font,
      spawnImpl: fakeSpawnWritingOutput(),
      logScheduledJob: (event, details) => events.push({ event, details }),
    })

    assert.equal(output.selectionMode, 'generated-fallback')
    assert.equal(output.videos.length, 1)
    assert.equal(output.videos[0].provider, 'GolfHomiez')
    assert.equal(events.some((entry) => entry.event === 'great_shots_provider_download_blocked' && entry.details.provider === 'Mixkit'), true)
    assert.equal(events.some((entry) => entry.event === 'great_shots_generated_fallback_selected'), true)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('great-shots configuration/docs preserve logging, migration, directories, and dependency-security requirements', async () => {
  const [envExample, docs, gitignore, packageJsonText, packageLockText] = await Promise.all([
    fsp.readFile(new URL('../.env.example', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../docs/GREAT_SHOTS_COMMERCIAL_JOB.md', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../package.json', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
  ])
  const packageJson = JSON.parse(packageJsonText)
  const packageLock = JSON.parse(packageLockText)

  assert.match(envExample, /Pexels Videos.*Wikimedia Commons.*Mixkit Free License.*Internet Archive/is)
  assert.match(envExample, /PEXELS_API_KEY=/)
  assert.match(envExample, /pexels\.com\/api\/key/i)
  assert.doesNotMatch(envExample, /PIXABAY_API_KEY=/)
  assert.match(envExample, /GREAT_SHOTS_FETCH_TIMEOUT_MS=15000/)
  assert.match(envExample, /GREAT_SHOTS_VIDEO_TIMEOUT_MS=30000/)
  assert.match(envExample, /GREAT_SHOTS_MAX_VIDEO_BYTES=62914560/)
  assert.match(envExample, /GREAT_SHOTS_FONT_FILE=/)
  assert.match(docs, /professional.*amateur/is)
  assert.match(docs, /free sources only/i)
  assert.match(docs, /Pexels Videos \(primary\)/i)
  assert.match(docs, /PEXELS_API_KEY/i)
  assert.match(docs, /Mixkit Free License/i)
  assert.match(docs, /Internet Archive/i)
  assert.match(docs, /missing, invalid, or rate-limited Pexels key is recoverable/i)
  assert.match(docs, /30 seconds total/i)
  assert.match(docs, /mixed pair.*preferred|prefer.*mixed pair/is)
  assert.match(docs, /single.*fallback|fallback.*single/is)
  assert.match(docs, /full qualifying source videos/i)
  assert.match(docs, /drone.*flyover|flyover.*drone/is)
  assert.match(docs, /actual downloaded duration/i)
  assert.match(docs, /setsar=1/i)
  assert.match(docs, /fontconfig/i)
  assert.match(docs, /same.*video|Never reuse a video/is)
  assert.match(docs, /scheduled_job_runs/)
  assert.match(docs, /No schema change is required/i)
  assert.match(docs, /logging\/access\.log/)
  assert.match(docs, /logging\/api\.log/)
  assert.match(docs, /logging\/error\.log/)
  assert.match(docs, /logging\/frontend\.log/)
  assert.match(docs, /correlation ID/i)
  assert.match(gitignore, /jobs\/\*/)
  assert.equal(fs.existsSync(new URL('../jobs/.gitkeep', import.meta.url)), true)
  assert.equal(fs.existsSync(new URL('../jobs/commercials/.gitkeep', import.meta.url)), true)
  assert.equal(packageJson.dependencies?.['ffmpeg-static'], undefined)
  assert.equal(packageJson.dependencies?.['yt-dlp'], undefined)
  assert.equal(packageJson.dependencies?.pexels, undefined)
  assert.match(packageJson.scripts?.postinstall || '', /db:migrate.*build/)
  assert.equal(packageLock.packages['node_modules/brace-expansion']?.version, '5.0.9')
  assert.equal(packageLock.packages['node_modules/nanoid']?.version, '3.3.18')
})
