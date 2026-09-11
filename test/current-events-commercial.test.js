import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { Buffer } from 'node:buffer'
import { setImmediate } from 'node:timers'
import process from 'node:process'
import {
  CURRENT_EVENTS_COMMERCIAL_DURATION_SECONDS,
  CURRENT_EVENTS_COMMERCIAL_JOB_ID,
  CURRENT_EVENTS_COMMERCIAL_JOB_NAME,
  CURRENT_EVENTS_NEWS_SOURCES,
  buildCurrentEventsCommercialCopy,
  buildCurrentEventsCommercialOutputPath,
  reserveCurrentEventsCommercialOutputPath,
  extractHeadlineCandidates,
  fetchCurrentGolfNews,
  runCreateShortFormCurrentEventsSmall,
  resolveCurrentEventsFontFile,
  selectCommonGolfTopic,
} from '../server/lib/current-events-commercial.js'
import {
  downloadRelevantImages,
  extractImageCandidates,
  fetchPexelsCurrentEventsMedia,
  generateGolfHomiezFallbackVisuals,
  parsePexelsCurrentEventsPhotos,
  parsePexelsCurrentEventsVideos,
  selectRelevantImageCandidates,
} from '../server/lib/current-events-visuals.js'
import { getManagedFfmpegSpec, getManagedFfmpegPath } from '../server/lib/ffmpeg-runtime.js'
import { SCHEDULED_JOB_DEFINITIONS } from '../server/lib/scheduled-jobs.js'
import { getLatestPexelsQuota, parsePexelsRateLimitHeaders, resetLatestPexelsQuotaForTests } from '../server/lib/pexels-api.js'

function fakeSpawnWritingOutput(captured = []) {
  return (_command, args) => {
    captured.push(args)
    const child = new EventEmitter()
    child.stderr = new PassThrough()
    child.kill = () => true
    const outputPath = args.at(-1)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, Buffer.from('fake-mp4-output'))
    setImmediate(() => child.emit('close', 0, null))
    return child
  }
}

test('current-events job uses the ten requested golf-news sources', () => {
  assert.equal(CURRENT_EVENTS_NEWS_SOURCES.length, 10)
  assert.deepEqual(CURRENT_EVENTS_NEWS_SOURCES.map((source) => source.name), [
    'Golf Digest',
    'GOLF.com',
    'Golf Channel',
    'Golfweek',
    'PGA TOUR News',
    'LPGA News',
    'Golf Monthly',
    'MyGolfSpy',
    'Skratch Golf',
    'No Laying Up',
  ])
  for (const source of CURRENT_EVENTS_NEWS_SOURCES) assert.match(source.url, /^https:\/\//)
})


test('Golf Channel HTTP 403 is recoverable through same-publisher fallback URLs', async () => {
  const golfChannel = CURRENT_EVENTS_NEWS_SOURCES.find((source) => source.name === 'Golf Channel')
  assert.ok(golfChannel)
  assert.ok(golfChannel.fallbackUrls?.length >= 1)

  const requested = []
  let errorLogCalls = 0
  const results = await fetchCurrentGolfNews({
    sources: [golfChannel],
    fetchImpl: async (url) => {
      requested.push(url)
      if (url === golfChannel.url) {
        return { ok: false, status: 403, text: async () => '' }
      }
      return {
        ok: true,
        status: 200,
        text: async () => '<html><h2>Solheim Cup need to know before Friday</h2></html>',
      }
    },
    logError: () => { errorLogCalls += 1 },
  })

  assert.equal(results.length, 1)
  assert.equal(results[0].ok, true)
  assert.equal(results[0].statusCode, 200)
  assert.equal(results[0].requestedUrl, golfChannel.fallbackUrls[0])
  assert.deepEqual(results[0].attempts.map((attempt) => attempt.statusCode), [403, 200])
  assert.equal(errorLogCalls, 0)
  assert.deepEqual(requested, [golfChannel.url, golfChannel.fallbackUrls[0]])
})

test('headline extraction and cross-source topic selection prefer a shared golf event', () => {
  const golfDigest = extractHeadlineCandidates('<html><h2>Solheim Cup 2026 preview: USA and Europe are ready</h2><a>Latest equipment reviews</a></html>')
  const golfCom = extractHeadlineCandidates('<html><h1>How to watch the Solheim Cup this week</h1><h2>Putting tips for amateurs</h2></html>')
  const lpga = extractHeadlineCandidates('<html><title>LPGA News</title><h2>Solheim Cup captains prepare their teams</h2></html>')

  const topic = selectCommonGolfTopic([
    { ok: true, name: 'Golf Digest', headlines: golfDigest },
    { ok: true, name: 'GOLF.com', headlines: golfCom },
    { ok: true, name: 'LPGA News', headlines: lpga },
  ])

  assert.equal(topic?.label, 'Solheim Cup')
  assert.equal(topic?.sourceCount, 3)
  assert.deepEqual(topic?.sourceNames, ['GOLF.com', 'Golf Digest', 'LPGA News'])
})

test('current-events source parsing captures relevant absolute and relative website images', () => {
  const html = `
    <html>
      <head><meta property="og:image" content="/media/solheim-cup-hero.jpg"></head>
      <body>
        <img src="https://cdn.example.com/logo.png" alt="Site logo">
        <img data-src="/media/solheim-cup-team.jpg" alt="Solheim Cup team celebration">
      </body>
    </html>`
  const images = extractImageCandidates(html, 'https://example.com/news/solheim-cup')
  assert.equal(images[0].url, 'https://example.com/media/solheim-cup-hero.jpg')
  assert.ok(images.some((image) => image.url === 'https://example.com/media/solheim-cup-team.jpg'))
  assert.equal(images.some((image) => /logo\.png/.test(image.url)), false)
})

test('relevant visual selection favors images tied to the shared current-events topic', () => {
  const selected = selectRelevantImageCandidates([
    {
      ok: true,
      name: 'Golf Digest',
      requestedUrl: 'https://example.com/news',
      images: [
        { url: 'https://img.example.com/equipment.jpg', alt: 'New driver testing', kind: 'img' },
        { url: 'https://img.example.com/solheim-cup-team.jpg', alt: 'Solheim Cup team celebration', kind: 'img' },
      ],
    },
    {
      ok: true,
      name: 'LPGA News',
      requestedUrl: 'https://lpga.example/news',
      images: [{ url: 'https://img.example.com/solheim-captain.jpg', alt: 'Solheim Cup captain', kind: 'meta' }],
    },
  ], { label: 'Solheim Cup', sourceNames: ['Golf Digest', 'LPGA News'] })

  assert.ok(selected[0].url.includes('solheim'))
  assert.ok(selected.some((image) => /solheim-cup-team/.test(image.url)))
  assert.ok(selected.some((image) => /solheim-captain/.test(image.url)))
  assert.equal(selected.some((image) => /equipment/.test(image.url)), false)
})

test('current-events image downloader rejects AVIF bytes served from a .webp URL and continues to a portable image', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-current-events-avif-'))
  try {
    const avif = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypavif', 'ascii'),
      Buffer.alloc(16),
    ])
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fe0dd3f60000000049454e44ae426082', 'hex')
    const logs = []
    const fetchImpl = async (url) => {
      const isAvif = url.includes('adaptive.webp')
      const bytes = isAvif ? avif : png
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => {
            if (name.toLowerCase() === 'content-type') return isAvif ? 'image/avif' : 'image/png'
            if (name.toLowerCase() === 'content-length') return String(bytes.length)
            return null
          },
        },
        arrayBuffer: async () => bytes,
      }
    }

    const downloaded = await downloadRelevantImages({
      candidates: [
        { url: 'https://images.example/adaptive.webp', sourceName: 'GOLF.com', sourcePageUrl: 'https://golf.com/news/' },
        { url: 'https://images.example/portable.png', sourceName: 'LPGA News', sourcePageUrl: 'https://www.lpga.com/news' },
      ],
      tempDir,
      fetchImpl,
      maxImages: 1,
      logScheduledJob: (event, details) => logs.push({ event, details }),
    })

    assert.equal(downloaded.length, 1)
    assert.equal(downloaded[0].sourceName, 'LPGA News')
    assert.match(downloaded[0].path, /\.png$/)
    assert.equal(logs.some((entry) => entry.event === 'current_events_image_download_failed' && /AVIF\/HEIF/.test(entry.details.error)), true)
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
})

test('current-events font resolver accepts an explicit readable font and avoids fontconfig dependency', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-current-events-font-'))
  try {
    const font = path.join(tempRoot, 'font.ttf')
    await fsp.writeFile(font, 'fake-font')
    assert.equal(await resolveCurrentEventsFontFile({ configuredPath: font, projectRoot: tempRoot }), font)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})


test('Pexels quota response headers expose monthly limit, remaining usage, and reset time', () => {
  const headers = {
    get(name) {
      const values = {
        'x-ratelimit-limit': '20000',
        'x-ratelimit-remaining': '19684',
        'x-ratelimit-reset': '1790000000',
      }
      return values[String(name).toLowerCase()] || null
    },
  }
  const quota = parsePexelsRateLimitHeaders(headers, { capturedAt: new Date('2026-09-09T14:00:00.000Z'), jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID, endpoint: '/v1/search' })
  assert.equal(quota.limit, 20000)
  assert.equal(quota.remaining, 19684)
  assert.equal(quota.used, 316)
  assert.equal(quota.jobId, CURRENT_EVENTS_COMMERCIAL_JOB_ID)
  assert.match(quota.resetAt, /^2026-/)
})

test('current-events Pexels discovery searches both photos and videos and records API quota metadata', async () => {
  const previous = process.env.PEXELS_API_KEY
  process.env.PEXELS_API_KEY = 'pexels-current-events-test-key'
  resetLatestPexelsQuotaForTests()
  const requests = []
  const logs = []
  const headers = {
    get(name) {
      const values = {
        'x-ratelimit-limit': '20000',
        'x-ratelimit-remaining': '19990',
        'x-ratelimit-reset': '1790000000',
      }
      return values[String(name).toLowerCase()] || null
    },
  }
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url)
    requests.push(parsed.pathname)
    assert.equal(options.headers?.Authorization, 'pexels-current-events-test-key')
    if (parsed.pathname === '/v1/search') {
      return {
        ok: true,
        status: 200,
        headers,
        json: async () => ({ photos: [{ id: 11, url: 'https://www.pexels.com/photo/golfer-11/', alt: 'Golfer teeing off', photographer: 'Photo Pro', photographer_url: 'https://www.pexels.com/@photo-pro', src: { portrait: 'https://images.pexels.com/photos/11/portrait.jpg' } }] }),
      }
    }
    if (parsed.pathname === '/v1/videos/search') {
      return {
        ok: true,
        status: 200,
        headers,
        json: async () => ({ videos: [{ id: 22, url: 'https://www.pexels.com/video/golfer-22/', duration: 8, user: { name: 'Video Pro', url: 'https://www.pexels.com/@video-pro' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/video-22.mp4' }] }] }),
      }
    }
    throw new Error(`Unexpected Pexels current-events URL: ${url}`)
  }

  try {
    const media = await fetchPexelsCurrentEventsMedia({
      topic: { label: 'Solheim Cup' },
      fetchImpl,
      correlationId: 'pexels-current-events-quota-test',
      logApi: (event, details) => logs.push({ event, details }),
    })
    assert.deepEqual(requests.sort(), ['/v1/search', '/v1/videos/search'].sort())
    assert.equal(media.photos.length, 1)
    assert.equal(media.videos.length, 1)
    assert.equal(media.photos[0].origin, 'pexels')
    assert.equal(media.videos[0].mediaType, 'video')
    assert.equal(logs.some((entry) => entry.event === 'pexels_api_quota_observed'), true)
    assert.equal(getLatestPexelsQuota()?.remaining, 19990)
  } finally {
    resetLatestPexelsQuotaForTests()
    if (previous === undefined) delete process.env.PEXELS_API_KEY
    else process.env.PEXELS_API_KEY = previous
  }
})

test('current-events Pexels parsers preserve creator attribution and reject over-30-second stock videos', () => {
  const photos = parsePexelsCurrentEventsPhotos({ photos: [{ id: 91, url: 'https://www.pexels.com/photo/golfer-91/', alt: 'Golfer on green', photographer: 'Golf Photographer', photographer_url: 'https://www.pexels.com/@golf-photographer', src: { large2x: 'https://images.pexels.com/photos/91/large.jpg' } }] })
  assert.equal(photos.length, 1)
  assert.equal(photos[0].creator, 'Golf Photographer')
  assert.equal(photos[0].license, 'Pexels License')

  const videos = parsePexelsCurrentEventsVideos({ videos: [
    { id: 92, url: 'https://www.pexels.com/video/golf-92/', duration: 12, user: { name: 'Golf Videographer' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/92.mp4' }] },
    { id: 93, url: 'https://www.pexels.com/video/golf-93/', duration: 45, user: { name: 'Long Clip' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/93.mp4' }] },
  ] })
  assert.equal(videos.length, 1)
  assert.equal(videos[0].pexelsId, '92')
  assert.equal(videos[0].creator, 'Golf Videographer')
})

test('generated GolfHomiez visuals provide usable 720x1280 PPM fallbacks without npm image dependencies', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-current-events-generated-visuals-'))
  try {
    const visuals = await generateGolfHomiezFallbackVisuals({ tempDir: tempRoot, count: 3 })
    assert.equal(visuals.length, 3)
    assert.equal(visuals.every((visual) => visual.origin === 'generated'), true)
    const first = await fsp.readFile(visuals[0].path)
    assert.equal(first.subarray(0, 16).toString('ascii').startsWith('P6\n720 1280\n255'), true)
    assert.ok(first.length > 720 * 1280 * 3)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('commercial copy mixes current golf news with the app-derived GolfHomiez theme and has a generic fallback', () => {
  const trending = buildCurrentEventsCommercialCopy({ label: 'Solheim Cup' })
  assert.match(trending.hook, /Solheim Cup/i)
  assert.match(trending.hook, /talking/i)
  assert.match(trending.punchline, /homiez/i)
  assert.match(trending.cta, /Track rounds/i)
  assert.match(trending.cta, /Challenge homiez/i)
  assert.match(trending.cta, /Keep the memories/i)
  assert.match(trending.cta, /GolfHomiez/i)

  const fallback = buildCurrentEventsCommercialCopy(null)
  assert.match(fallback.hook, /Golf/i)
  assert.match(fallback.cta, /GolfHomiez/i)
})

test('commercial output path uses jobs/commercials plus the exact job name and date', () => {
  const output = buildCurrentEventsCommercialOutputPath({
    now: new Date('2026-09-08T19:00:00.000Z'),
    projectRoot: '/srv/golfhomiez',
  })
  assert.equal(output, path.join('/srv/golfhomiez', 'jobs', 'commercials', `${CURRENT_EVENTS_COMMERCIAL_JOB_NAME} - 2026-09-08.mp4`))
  assert.equal(CURRENT_EVENTS_COMMERCIAL_DURATION_SECONDS, 6)
})

test('commercial output reservation increments filenames instead of overwriting an existing mp4', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-current-events-output-reservation-'))
  try {
    const outputDir = path.join(tempRoot, 'jobs', 'commercials')
    await fsp.mkdir(outputDir, { recursive: true })
    const base = buildCurrentEventsCommercialOutputPath({ now: new Date('2026-09-08T19:00:00.000Z'), projectRoot: tempRoot })
    await fsp.writeFile(base, 'original-commercial')
    await fsp.writeFile(base.replace(/\.mp4$/, ' - 2.mp4'), 'second-commercial')

    const reservation = await reserveCurrentEventsCommercialOutputPath({ now: new Date('2026-09-08T19:00:00.000Z'), projectRoot: tempRoot })
    try {
      assert.equal(path.basename(reservation.outputPath), `${CURRENT_EVENTS_COMMERCIAL_JOB_NAME} - 2026-09-08 - 3.mp4`)
      assert.equal(reservation.sequence, 3)
      assert.equal(await fsp.readFile(base, 'utf8'), 'original-commercial')
      assert.equal(await fsp.readFile(base.replace(/\.mp4$/, ' - 2.mp4'), 'utf8'), 'second-commercial')
    } finally {
      await fsp.rm(reservation.lockPath, { force: true })
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('scheduled-job registry exposes Create Short-form Current Events - Small as manual, schedulable, background work', () => {
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.id === CURRENT_EVENTS_COMMERCIAL_JOB_ID)
  assert.ok(definition)
  assert.equal(definition.name, CURRENT_EVENTS_COMMERCIAL_JOB_NAME)
  assert.deepEqual(definition.defaultSchedule, { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null })
  assert.equal(definition.backgroundManualRun, true)
  assert.equal(typeof definition.run, 'function')
})

test('job creates a six-second mp4 using injected current-news results without requiring network in tests', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-current-events-'))
  const capturedArgs = []
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), Buffer.from('fake-png'))

    const output = await runCreateShortFormCurrentEventsSmall({
      projectRoot: tempRoot,
      now: new Date('2026-09-08T19:00:00.000Z'),
      correlationId: 'test-current-events-correlation',
      sourceResults: [
        { ok: true, name: 'Golf Digest', headlines: ['Solheim Cup 2026 preview'] },
        { ok: true, name: 'GOLF.com', headlines: ['Solheim Cup teams prepare for Friday'] },
        { ok: true, name: 'LPGA News', headlines: ['Solheim Cup captains at Bernardus'] },
      ],
      spawnImpl: fakeSpawnWritingOutput(capturedArgs),
    })

    assert.equal(output.fileName, `${CURRENT_EVENTS_COMMERCIAL_JOB_NAME} - 2026-09-08.mp4`)
    assert.equal(output.relativePath, `jobs/commercials/${CURRENT_EVENTS_COMMERCIAL_JOB_NAME} - 2026-09-08.mp4`)
    assert.equal(output.durationSeconds, 6)
    assert.equal(output.resolution, '720x1280')
    assert.equal(output.topic, 'Solheim Cup')
    assert.equal(output.topicSourceCount, 3)
    assert.equal(output.usedGolfHomiezFallback, false)
    assert.equal(output.websiteImageCount, 0)
    assert.equal(output.generatedVisualCount, 3)
    assert.deepEqual(output.visualSources, ['GolfHomiez', 'GolfHomiez', 'GolfHomiez'])
    assert.ok(output.bytes > 0)
    assert.equal(capturedArgs.length, 1)
    assert.ok(capturedArgs[0].includes('libx264'))
    assert.ok(capturedArgs[0].includes('+faststart'))
    assert.match(capturedArgs[0].join(' '), /zoompan/)
    assert.match(capturedArgs[0].join(' '), /TRENDING NOW/)
    assert.match(capturedArgs[0].join(' '), /MAKE IT YOURS/)
    assert.match(capturedArgs[0].join(' '), /TEE IT UP/)
    const filterComplex = capturedArgs[0][capturedArgs[0].indexOf('-filter_complex') + 1]
    assert.match(filterComplex, /drawtext=fontfile='/)
    assert.equal((filterComplex.match(/drawtext=fontfile=/g) || []).length, 11)
    assert.ok(fs.existsSync(path.join(tempRoot, output.relativePath)))
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('job uses a relevant website image, fills missing scenes with generated golf art, and preserves earlier same-day output', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-current-events-images-and-increment-'))
  const capturedArgs = []
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), Buffer.from('fake-png'))
    const baseOutput = buildCurrentEventsCommercialOutputPath({ now: new Date('2026-09-08T19:00:00.000Z'), projectRoot: tempRoot })
    await fsp.mkdir(path.dirname(baseOutput), { recursive: true })
    await fsp.writeFile(baseOutput, Buffer.from('keep-this-commercial'))

    const tinyPng = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fe0dd3f60000000049454e44ae426082', 'hex')
    const fetchImpl = async (url) => {
      assert.equal(url, 'https://images.example.com/solheim-cup.jpg')
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => tinyPng,
      }
    }

    const output = await runCreateShortFormCurrentEventsSmall({
      projectRoot: tempRoot,
      now: new Date('2026-09-08T19:00:00.000Z'),
      sourceResults: [
        {
          ok: true,
          name: 'Golf Digest',
          requestedUrl: 'https://golfdigest.example/news',
          headlines: ['Solheim Cup 2026 preview'],
          images: [{ url: 'https://images.example.com/solheim-cup.jpg', alt: 'Solheim Cup team', kind: 'meta' }],
        },
        { ok: true, name: 'LPGA News', headlines: ['Solheim Cup captains prepare'], images: [] },
      ],
      fetchImpl,
      spawnImpl: fakeSpawnWritingOutput(capturedArgs),
    })

    assert.equal(output.fileName, `${CURRENT_EVENTS_COMMERCIAL_JOB_NAME} - 2026-09-08 - 2.mp4`)
    assert.equal(output.outputSequence, 2)
    assert.equal(output.websiteImageCount, 1)
    assert.equal(output.generatedVisualCount, 2)
    assert.deepEqual(output.visualSources, ['Golf Digest', 'GolfHomiez', 'GolfHomiez'])
    assert.equal((await fsp.readFile(baseOutput)).toString(), 'keep-this-commercial')
    assert.ok(fs.existsSync(path.join(tempRoot, output.relativePath)))
    assert.equal(fs.existsSync(`${path.join(tempRoot, output.relativePath)}.lock`), false)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})


test('current-events job uses Pexels photos/videos first and persists Pexels quota plus media metadata in run output', async () => {
  const previous = process.env.PEXELS_API_KEY
  process.env.PEXELS_API_KEY = 'pexels-current-events-render-key'
  resetLatestPexelsQuotaForTests()
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-current-events-pexels-media-'))
  const capturedArgs = []
  const tinyPng = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fe0dd3f60000000049454e44ae426082', 'hex')
  const fakeMp4 = Buffer.from('fake-pexels-video')
  const quotaHeaders = {
    get(name) {
      const values = {
        'x-ratelimit-limit': '20000',
        'x-ratelimit-remaining': '19975',
        'x-ratelimit-reset': '1790000000',
      }
      return values[String(name).toLowerCase()] || null
    },
  }

  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), Buffer.from('fake-png'))
    const fetchImpl = async (url) => {
      const parsed = new URL(url)
      if (parsed.hostname === 'api.pexels.com' && parsed.pathname === '/v1/search') {
        return { ok: true, status: 200, headers: quotaHeaders, json: async () => ({ photos: [{ id: 201, url: 'https://www.pexels.com/photo/golf-201/', alt: 'Golfer on a green', photographer: 'Pexels Photo Creator', src: { portrait: 'https://images.pexels.com/photos/201/photo.jpg' } }] }) }
      }
      if (parsed.hostname === 'api.pexels.com' && parsed.pathname === '/v1/videos/search') {
        return { ok: true, status: 200, headers: quotaHeaders, json: async () => ({ videos: [{ id: 202, url: 'https://www.pexels.com/video/golf-202/', duration: 7, user: { name: 'Pexels Video Creator' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/video-202.mp4' }] }] }) }
      }
      if (parsed.hostname === 'images.pexels.com') {
        return { ok: true, status: 200, headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : name.toLowerCase() === 'content-length' ? String(tinyPng.length) : null }, arrayBuffer: async () => tinyPng }
      }
      if (parsed.hostname === 'videos.pexels.com') {
        return { ok: true, status: 200, headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'video/mp4' : name.toLowerCase() === 'content-length' ? String(fakeMp4.length) : null }, arrayBuffer: async () => fakeMp4 }
      }
      throw new Error(`Unexpected current-events Pexels render URL: ${url}`)
    }

    const output = await runCreateShortFormCurrentEventsSmall({
      projectRoot: tempRoot,
      now: new Date('2026-09-09T14:00:00.000Z'),
      sourceResults: [
        { ok: true, name: 'Golf Digest', headlines: ['Solheim Cup preview and teams'] },
        { ok: true, name: 'LPGA News', headlines: ['Solheim Cup captains prepare'] },
      ],
      fetchImpl,
      spawnImpl: fakeSpawnWritingOutput(capturedArgs),
    })

    assert.equal(output.pexelsVisualCount, 2)
    assert.equal(output.pexelsPhotoCount, 1)
    assert.equal(output.pexelsVideoCount, 1)
    assert.equal(output.generatedVisualCount, 1)
    assert.equal(output.pexelsQuota.remaining, 19975)
    assert.equal(output.pexelsAttribution.length, 2)
    assert.deepEqual(output.visualSources, ['Pexels', 'Pexels', 'GolfHomiez'])
    const argsText = capturedArgs[0].join(' ')
    assert.match(argsText, /tpad=stop_mode=clone/)
  } finally {
    resetLatestPexelsQuotaForTests()
    if (previous === undefined) delete process.env.PEXELS_API_KEY
    else process.env.PEXELS_API_KEY = previous
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('missing ffmpeg automatically installs a managed verified runtime and retries the same render', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-current-events-ffmpeg-fallback-'))
  const commands = []
  let setupCalls = 0
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), Buffer.from('fake-png'))

    const spawnImpl = (command, args) => {
      commands.push(command)
      const child = new EventEmitter()
      child.stderr = new PassThrough()
      child.kill = () => true
      if (commands.length === 1) {
        setImmediate(() => {
          const error = new Error(`spawn ${command} ENOENT`)
          error.code = 'ENOENT'
          child.emit('error', error)
        })
      } else {
        const outputPath = args.at(-1)
        fs.mkdirSync(path.dirname(outputPath), { recursive: true })
        fs.writeFileSync(outputPath, Buffer.from('fake-managed-ffmpeg-mp4'))
        setImmediate(() => child.emit('close', 0, null))
      }
      return child
    }

    const output = await runCreateShortFormCurrentEventsSmall({
      projectRoot: tempRoot,
      now: new Date('2026-09-08T19:00:00.000Z'),
      sourceResults: [
        { ok: true, name: 'Golf Digest', headlines: ['Solheim Cup 2026 preview'] },
        { ok: true, name: 'GOLF.com', headlines: ['Solheim Cup teams prepare for Friday'] },
      ],
      ffmpegPath: 'definitely-missing-ffmpeg',
      autoDownloadFfmpeg: true,
      ensureFfmpegImpl: async () => {
        setupCalls += 1
        return '/managed/ffmpeg'
      },
      spawnImpl,
    })

    assert.equal(setupCalls, 1)
    assert.deepEqual(commands, ['definitely-missing-ffmpeg', '/managed/ffmpeg'])
    assert.equal(output.durationSeconds, 6)
    assert.ok(fs.existsSync(path.join(tempRoot, output.relativePath)))
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('managed ffmpeg metadata is pinned for Windows x64 and stored outside source control', () => {
  const spec = getManagedFfmpegSpec({ platform: 'win32', arch: 'x64' })
  assert.equal(spec?.version, '6.1.1')
  assert.equal(spec?.asset, 'ffmpeg-win32-x64.gz')
  assert.equal(spec?.compressedSha256, '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77')
  assert.equal(spec?.binarySha256, '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00')
  assert.match(getManagedFfmpegPath({ projectRoot: 'C:/GolfHomiez', platform: 'win32', arch: 'x64' }).replace(/\\/g, '/'), /\.runtime\/ffmpeg\/6\.1\.1\/win32-x64\/ffmpeg\.exe$/)
})

test('runtime artifacts are ignored while jobs directory structure, ffmpeg deployment, and docs are preserved', async () => {
  const [gitignore, dockerfile, envExample, docs] = await Promise.all([
    fsp.readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../.env.example', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../docs/CURRENT_EVENTS_COMMERCIAL_JOB.md', import.meta.url), 'utf8'),
  ])

  assert.match(gitignore, /jobs\/\*/)
  assert.match(gitignore, /!jobs\/\.gitkeep/)
  assert.match(gitignore, /!jobs\/commercials\//)
  assert.match(gitignore, /jobs\/commercials\/\*/)
  assert.match(gitignore, /!jobs\/commercials\/\.gitkeep/)
  assert.match(gitignore, /\.runtime\//)
  assert.equal(fs.existsSync(new URL('../jobs/.gitkeep', import.meta.url)), true)
  assert.equal(fs.existsSync(new URL('../jobs/commercials/.gitkeep', import.meta.url)), true)
  assert.match(dockerfile, /apt-get install -y --no-install-recommends ffmpeg/)
  assert.match(envExample, /FFMPEG_PATH=ffmpeg/)
  assert.match(envExample, /FFMPEG_AUTO_DOWNLOAD=true/)
  assert.match(envExample, /FFMPEG_DOWNLOAD_TIMEOUT_MS=120000/)
  assert.match(envExample, /CURRENT_EVENTS_FETCH_TIMEOUT_MS=10000/)
  assert.match(docs, /No schema change is required/)
  assert.match(docs, /logging\/frontend\.log/)
  assert.match(docs, /correlation ID/i)
  assert.match(docs, /HTTP 403/)
  assert.match(docs, /SHA-256/)
  assert.match(docs, /without overwriting any existing MP4/i)
  assert.match(docs, /YYYY-MM-DD - 2\.mp4/)
  assert.match(docs, /generated GolfHomiez golf artwork/i)
})

test('no npm dependency was added for video generation and patched audit-sensitive packages remain locked', async () => {
  const packageJson = JSON.parse(await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const packageLock = JSON.parse(await fsp.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))

  assert.equal(packageJson.dependencies?.['ffmpeg-static'], undefined)
  assert.equal(packageJson.devDependencies?.['ffmpeg-static'], undefined)
  assert.equal(packageJson.scripts?.['setup:ffmpeg'], 'node server/scripts/ensure-ffmpeg.js')
  assert.match(packageJson.scripts?.postinstall || '', /db:migrate.*build/)
  assert.equal(packageLock.packages['node_modules/brace-expansion']?.version, '5.0.9')
  assert.equal(packageLock.packages['node_modules/nanoid']?.version, '3.3.18')
})
