import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { gunzip as gunzipCallback } from 'node:zlib'
import { promisify } from 'node:util'

const gunzip = promisify(gunzipCallback)

export const MANAGED_FFMPEG_VERSION = '6.1.1'
const MANAGED_FFMPEG_RELEASE_TAG = `b${MANAGED_FFMPEG_VERSION}`
const MANAGED_FFMPEG_BASE_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${MANAGED_FFMPEG_RELEASE_TAG}`

const MANAGED_FFMPEG_SPECS = Object.freeze({
  'darwin-arm64': Object.freeze({
    asset: 'ffmpeg-darwin-arm64.gz',
    compressedSha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
    binarySha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
  }),
  'darwin-x64': Object.freeze({
    asset: 'ffmpeg-darwin-x64.gz',
    compressedSha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
    binarySha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
  }),
  'linux-arm': Object.freeze({
    asset: 'ffmpeg-linux-arm.gz',
    compressedSha256: '64b115a12f0ab77c277e3c418aae8b40ef881e75e746a0e2d066a206b9bc5172',
    binarySha256: '0afba4a11110e6e402053e0fc14c33a7eb207d7a588688ae87dba471a0f06c71',
  }),
  'linux-arm64': Object.freeze({
    asset: 'ffmpeg-linux-arm64.gz',
    compressedSha256: '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0',
    binarySha256: '6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce',
  }),
  'linux-x64': Object.freeze({
    asset: 'ffmpeg-linux-x64.gz',
    compressedSha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
    binarySha256: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99',
  }),
  'win32-x64': Object.freeze({
    asset: 'ffmpeg-win32-x64.gz',
    compressedSha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
    binarySha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
  }),
})

function envBoolean(value, fallback = true) {
  if (value == null || String(value).trim() === '') return fallback
  return !/^(?:0|false|no|off)$/i.test(String(value).trim())
}

function normalizedDownloadTimeoutMs(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 10000 && parsed <= 600000 ? parsed : 120000
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function sourceAbortSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

export function isManagedFfmpegAutoDownloadEnabled(value = process.env.FFMPEG_AUTO_DOWNLOAD) {
  return envBoolean(value, true)
}

export function getManagedFfmpegSpec({ platform = process.platform, arch = process.arch } = {}) {
  const key = `${platform}-${arch}`
  const spec = MANAGED_FFMPEG_SPECS[key]
  if (!spec) return null
  return {
    ...spec,
    key,
    platform,
    arch,
    version: MANAGED_FFMPEG_VERSION,
    url: `${MANAGED_FFMPEG_BASE_URL}/${spec.asset}`,
  }
}

export function getManagedFfmpegPath({ projectRoot = process.cwd(), platform = process.platform, arch = process.arch } = {}) {
  const executable = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return path.join(projectRoot, '.runtime', 'ffmpeg', MANAGED_FFMPEG_VERSION, `${platform}-${arch}`, executable)
}

export function resolveFfmpegPath({
  projectRoot = process.cwd(),
  configuredPath = process.env.FFMPEG_PATH,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const configured = String(configuredPath || '').trim().replace(/^['"]|['"]$/g, '')
  if (configured && configured.toLowerCase() !== 'ffmpeg') return configured

  const managedPath = getManagedFfmpegPath({ projectRoot, platform, arch })
  if (fs.existsSync(managedPath)) return managedPath
  return configured || 'ffmpeg'
}

export async function ensureManagedFfmpeg({
  projectRoot = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
  timeoutMs = normalizedDownloadTimeoutMs(process.env.FFMPEG_DOWNLOAD_TIMEOUT_MS),
  force = false,
} = {}) {
  const spec = getManagedFfmpegSpec({ platform, arch })
  if (!spec) {
    const error = new Error(`Automatic ffmpeg setup is not supported for ${platform}/${arch}. Install ffmpeg and set FFMPEG_PATH.`)
    error.code = 'FFMPEG_PLATFORM_UNSUPPORTED'
    throw error
  }
  if (typeof fetchImpl !== 'function') {
    const error = new Error('Automatic ffmpeg setup requires a fetch implementation')
    error.code = 'FFMPEG_DOWNLOAD_UNAVAILABLE'
    throw error
  }

  const targetPath = getManagedFfmpegPath({ projectRoot, platform, arch })
  if (!force && fs.existsSync(targetPath)) return targetPath

  const targetDir = path.dirname(targetPath)
  await fsp.mkdir(targetDir, { recursive: true })
  const tempPath = `${targetPath}.download-${process.pid}-${Date.now()}`
  const details = {
    correlationId,
    component: 'ffmpeg-runtime',
    version: spec.version,
    platform,
    arch,
    asset: spec.asset,
    targetPath,
  }
  logApi('ffmpeg_managed_download_started', details)
  logScheduledJob('ffmpeg_managed_download_started', details)

  try {
    const response = await fetchImpl(spec.url, {
      method: 'GET',
      redirect: 'follow',
      signal: sourceAbortSignal(signal, timeoutMs),
      headers: {
        Accept: 'application/octet-stream,*/*;q=0.8',
        'User-Agent': 'GolfHomiez/1.0 ffmpeg-bootstrap',
      },
    })
    if (!response?.ok) {
      const error = new Error(`ffmpeg download returned HTTP ${response?.status || 'unknown'}`)
      error.code = 'FFMPEG_DOWNLOAD_FAILED'
      error.statusCode = response?.status || null
      throw error
    }

    const compressed = Buffer.from(await response.arrayBuffer())
    const compressedDigest = sha256(compressed)
    if (compressedDigest !== spec.compressedSha256) {
      const error = new Error('Downloaded ffmpeg archive failed SHA-256 verification')
      error.code = 'FFMPEG_DOWNLOAD_CHECKSUM_MISMATCH'
      throw error
    }

    const binary = await gunzip(compressed)
    const binaryDigest = sha256(binary)
    if (binaryDigest !== spec.binarySha256) {
      const error = new Error('Extracted ffmpeg executable failed SHA-256 verification')
      error.code = 'FFMPEG_BINARY_CHECKSUM_MISMATCH'
      throw error
    }

    await fsp.writeFile(tempPath, binary, { mode: platform === 'win32' ? 0o666 : 0o755 })
    if (platform !== 'win32') await fsp.chmod(tempPath, 0o755)
    await fsp.rm(targetPath, { force: true })
    await fsp.rename(tempPath, targetPath)

    const completedDetails = { ...details, bytes: binary.length }
    logApi('ffmpeg_managed_download_completed', completedDetails)
    logScheduledJob('ffmpeg_managed_download_completed', completedDetails)
    return targetPath
  } catch (error) {
    logApi('ffmpeg_managed_download_failed', { ...details, level: 'error', error: error?.message || String(error) })
    logScheduledJob('ffmpeg_managed_download_failed', { ...details, level: 'error', error: error?.message || String(error) })
    throw error
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
  }
}
