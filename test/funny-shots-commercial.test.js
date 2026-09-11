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
  FUNNY_SHOTS_COMMERCIAL_FILE_TAG,
  FUNNY_SHOTS_COMMERCIAL_JOB_ID,
  FUNNY_SHOTS_COMMERCIAL_JOB_NAME,
  FUNNY_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS,
  buildFunnyShotsCommercialOutputPath,
  fetchFunnyShotCandidates,
  isFunnyShotVideoCandidate,
  parseUsedFunnyShotKeys,
  renderFunnyShotsCommercial,
  reserveFunnyShotsCommercialOutputPath,
  runCreateShortFormFunnyShotsSmall,
  selectFunnyShotVideos,
} from '../server/lib/funny-shots-commercial.js'
import {
  COMMERCIAL_BACKGROUND_MUSIC_NAME,
  COMMERCIAL_BACKGROUND_MUSIC_RELATIVE_PATH,
  DEFAULT_COMMERCIAL_BACKGROUND_MUSIC_VOLUME,
  resolveCommercialBackgroundMusicFile,
} from '../server/lib/commercial-background-music.js'
import { SCHEDULED_JOB_DEFINITIONS } from '../server/lib/scheduled-jobs.js'

function pexelsCandidate(id, durationSeconds = 8, title = 'funny golfer misses golf shot') {
  return {
    key: `pexels:${id}`,
    provider: 'Pexels',
    id: String(id),
    category: 'funny',
    categories: ['funny'],
    query: 'funny golf fail golfer',
    title,
    description: `${title} with a funny reaction`,
    author: 'Pexels Creator',
    authorUrl: 'https://www.pexels.com/@creator/',
    license: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    sourcePageUrl: `https://www.pexels.com/video/${title.replace(/\s+/g, '-')}-${id}/`,
    downloadUrl: `https://videos.pexels.com/video-files/${id}/${id}-hd.mp4`,
    durationSeconds,
    width: 1080,
    height: 1920,
  }
}

function fakeSpawn(captured = [], probeDuration = 8) {
  return (_command, args) => {
    captured.push(args)
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    const output = args.at(-1)
    setImmediate(() => {
      if (output === '-') {
        child.stderr.write(`Duration: 00:00:${String(probeDuration).padStart(2, '0')}.000, start: 0.000000, bitrate: 1000 kb/s\n`)
      } else {
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.writeFileSync(output, Buffer.from('fake-funny-shots-mp4'))
      }
      child.stdout.end()
      child.stderr.end()
      child.emit('close', 0, null)
    })
    return child
  }
}

test('Funny Shots scheduled job has the requested identity and follows the Great Shots scheduling format', () => {
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.id === FUNNY_SHOTS_COMMERCIAL_JOB_ID)
  assert.ok(definition)
  assert.equal(definition.name, FUNNY_SHOTS_COMMERCIAL_JOB_NAME)
  assert.equal(definition.name, 'Create Short-form Funny Shots - Small')
  assert.deepEqual(definition.defaultSchedule, { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null })
  assert.equal(definition.backgroundManualRun, true)
  assert.match(definition.description, /Pexels.*funny golf shots/is)
})

test('Funny Shots output naming includes job name, FunnyShotShort and date without overwriting prior MP4s', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-funny-output-'))
  try {
    const base = buildFunnyShotsCommercialOutputPath({ now: new Date('2026-09-09T15:00:00.000Z'), projectRoot: tempRoot })
    assert.equal(path.basename(base), `${FUNNY_SHOTS_COMMERCIAL_JOB_NAME} - ${FUNNY_SHOTS_COMMERCIAL_FILE_TAG} - 2026-09-09.mp4`)
    assert.equal(FUNNY_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS, 30)
    await fsp.mkdir(path.dirname(base), { recursive: true })
    await fsp.writeFile(base, 'existing')
    const reservation = await reserveFunnyShotsCommercialOutputPath({ now: new Date('2026-09-09T15:00:00.000Z'), projectRoot: tempRoot })
    try {
      assert.equal(path.basename(reservation.outputPath), `${FUNNY_SHOTS_COMMERCIAL_JOB_NAME} - ${FUNNY_SHOTS_COMMERCIAL_FILE_TAG} - 2026-09-09 - 2.mp4`)
      assert.equal(await fsp.readFile(base, 'utf8'), 'existing')
    } finally {
      await fsp.rm(reservation.lockPath, { force: true })
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('Funny Shots accepts funny people-playing-golf clips and rejects generic course or tutorial footage', () => {
  assert.equal(isFunnyShotVideoCandidate(pexelsCandidate('1')), true)
  assert.equal(isFunnyShotVideoCandidate(pexelsCandidate('2', 31)), false)
  assert.equal(isFunnyShotVideoCandidate(pexelsCandidate('3', 8, 'drone flyover golf course tour')), false)
  assert.equal(isFunnyShotVideoCandidate(pexelsCandidate('4', 8, 'golf lesson tutorial with professional golfer')), false)
  assert.equal(isFunnyShotVideoCandidate({ ...pexelsCandidate('5'), provider: 'Wikimedia Commons' }), false)
})

test('Funny Shots Pexels discovery uses funny golf queries and preserves Pexels source metadata', async () => {
  const priorKey = process.env.PEXELS_API_KEY
  process.env.PEXELS_API_KEY = 'test-pexels-key'
  const urls = []
  try {
    const candidates = await fetchFunnyShotCandidates({
      fetchImpl: async (url, options) => {
        urls.push(String(url))
        assert.equal(options.headers.Authorization, 'test-pexels-key')
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name.toLowerCase() === 'x-ratelimit-limit' ? '20000' : name.toLowerCase() === 'x-ratelimit-remaining' ? '19990' : null },
          json: async () => ({
            videos: [{
              id: 123,
              duration: 8,
              url: 'https://www.pexels.com/video/funny-golfer-misses-golf-shot-123/',
              user: { name: 'Funny Golfer Creator', url: 'https://www.pexels.com/@creator/' },
              video_files: [{ id: 1, quality: 'hd', file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/video-files/123/123-hd.mp4' }],
            }],
          }),
        }
      },
    })
    assert.ok(urls.length >= 5)
    assert.equal(urls.every((url) => url.includes('/v1/videos/search')), true)
    assert.equal(urls.some((url) => new URL(url).searchParams.get('query')?.includes('funny golf')), true)
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].provider, 'Pexels')
    assert.equal(candidates[0].license, 'Pexels License')
    assert.match(candidates[0].sourcePageUrl, /pexels\.com\/video/)
  } finally {
    if (priorKey == null) delete process.env.PEXELS_API_KEY
    else process.env.PEXELS_API_KEY = priorKey
  }
})

test('Funny Shots prefers two unused full clips when their combined duration fits 30 seconds', () => {
  const candidates = [pexelsCandidate('1', 9), pexelsCandidate('2', 11), pexelsCandidate('3', 25)]
  const selected = selectFunnyShotVideos(candidates, new Set(['pexels:3']))
  assert.equal(selected.length, 2)
  assert.deepEqual(selected.map((clip) => clip.key).sort(), ['pexels:1', 'pexels:2'])
  assert.ok(selected.reduce((sum, clip) => sum + clip.durationSeconds, 0) <= 30)
})

test('Funny Shots keeps no-reuse history isolated under videos[].key', () => {
  const used = parseUsedFunnyShotKeys([
    { output_json: JSON.stringify({ videos: [{ key: 'pexels:100' }, { key: 'pexels:101' }] }) },
    { output_json: { videos: [{ key: 'pexels:102' }] } },
  ])
  assert.deepEqual([...used].sort(), ['pexels:100', 'pexels:101', 'pexels:102'])
})

test('Great and Funny Shots use the bundled Golf Homiez for Golf Courses background track at a subtle default level', async () => {
  const music = await resolveCommercialBackgroundMusicFile()
  const stat = await fsp.stat(music)
  assert.ok(stat.size > 1000)
  assert.equal(path.basename(music), path.basename(COMMERCIAL_BACKGROUND_MUSIC_RELATIVE_PATH))
  assert.equal(COMMERCIAL_BACKGROUND_MUSIC_NAME, 'Golf Homiez for Golf Courses')
  assert.equal(DEFAULT_COMMERCIAL_BACKGROUND_MUSIC_VOLUME, 0.12)
})

test('Funny Shots renderer maps the subtle music track and keeps the same vertical GolfHomiez branding format', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-funny-render-'))
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), 'emblem')
    const clipPath = path.join(tempRoot, 'funny.mp4')
    const fontPath = path.join(tempRoot, 'font.ttf')
    await fsp.writeFile(clipPath, 'clip')
    await fsp.writeFile(fontPath, 'font')
    const captured = []
    const outputPath = path.join(tempRoot, 'jobs', 'commercials', 'funny.mp4')
    const result = await renderFunnyShotsCommercial({
      outputPath,
      clips: [{ ...pexelsCandidate('1', 8), localPath: clipPath }],
      projectRoot: tempRoot,
      fontFile: fontPath,
      resolveFontFileImpl: async () => fontPath,
      spawnImpl: fakeSpawn(captured),
    })
    assert.equal(result.durationSeconds, 8)
    assert.equal(result.width, 720)
    assert.equal(result.height, 1280)
    assert.equal(result.backgroundMusic.name, 'Golf Homiez for Golf Courses')
    const args = captured[0]
    const filter = args[args.indexOf('-filter_complex') + 1]
    assert.match(filter, /FUNNY SHOT/)
    assert.match(filter, /GOLF HAPPENS/)
    assert.match(filter, /LOG IT\. SHARE IT\. LAUGH AGAIN\./)
    assert.match(filter, /volume=0\.120/)
    assert.ok(args.includes('[aout]'))
    assert.ok(args.includes('aac'))
    assert.equal(args.includes('-an'), false)
    assert.ok(fs.existsSync(outputPath))
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('Funny Shots end-to-end run downloads unused Pexels funny footage and returns commercial metadata', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gh-funny-run-'))
  try {
    await fsp.mkdir(path.join(tempRoot, 'src', 'assets'), { recursive: true })
    await fsp.writeFile(path.join(tempRoot, 'src', 'assets', 'GolfHomiezEmblem.png'), 'emblem')
    const fontPath = path.join(tempRoot, 'font.ttf')
    await fsp.writeFile(fontPath, 'font')
    const captured = []
    const candidates = [pexelsCandidate('201', 8), pexelsCandidate('202', 8)]
    const output = await runCreateShortFormFunnyShotsSmall({
      projectRoot: tempRoot,
      now: new Date('2026-09-09T15:00:00.000Z'),
      candidates,
      usedVideoKeys: new Set(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'video/mp4' : name.toLowerCase() === 'content-length' ? '16' : null },
        arrayBuffer: async () => Buffer.from('fake-video-bytes').buffer,
      }),
      fontFile: fontPath,
      spawnImpl: fakeSpawn(captured, 8),
    })
    assert.equal(output.fileName, `${FUNNY_SHOTS_COMMERCIAL_JOB_NAME} - ${FUNNY_SHOTS_COMMERCIAL_FILE_TAG} - 2026-09-09.mp4`)
    assert.equal(output.selectionMode, 'funny-pair')
    assert.equal(output.pexelsVideoCount, 2)
    assert.equal(output.videos.every((video) => video.provider === 'Pexels' && video.category === 'funny'), true)
    assert.equal(output.backgroundMusic.name, 'Golf Homiez for Golf Courses')
    assert.ok(fs.existsSync(path.join(tempRoot, output.relativePath)))
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('Funny Shots configuration and Admin UI document Pexels, music, quota metadata and downloadable latest MP4 behavior', async () => {
  const [envExample, docs, adminUi, packageJsonText] = await Promise.all([
    fsp.readFile(new URL('../.env.example', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../docs/FUNNY_SHOTS_COMMERCIAL_JOB.md', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../src/pages/AdminScheduledJobs.tsx', import.meta.url), 'utf8'),
    fsp.readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ])
  const packageJson = JSON.parse(packageJsonText)
  assert.match(envExample, /FUNNY_SHOTS_FETCH_TIMEOUT_MS=15000/)
  assert.match(envExample, /COMMERCIAL_BACKGROUND_MUSIC_VOLUME=0\.12/)
  assert.match(docs, /Pexels/i)
  assert.match(docs, /funny golf/i)
  assert.match(docs, /Golf Homiez for Golf Courses/i)
  assert.match(docs, /Download latest MP4/i)
  assert.match(adminUi, /createShortFormFunnyShotsSmall/)
  assert.match(adminUi, /funny golf shots/i)
  assert.match(packageJson.scripts.test, /test\/funny-shots-commercial\.test\.js/)
})
