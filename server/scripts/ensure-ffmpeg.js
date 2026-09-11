import { spawnSync } from 'node:child_process'
import process from 'node:process'
import {
  ensureManagedFfmpeg,
  isManagedFfmpegAutoDownloadEnabled,
  resolveFfmpegPath,
} from '../lib/ffmpeg-runtime.js'

function commandWorks(command) {
  if (!command) return false
  try {
    const result = spawnSync(command, ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 10000 })
    return result.status === 0
  } catch {
    return false
  }
}

async function main() {
  if (!isManagedFfmpegAutoDownloadEnabled()) {
    console.log('[ffmpeg-setup] Automatic ffmpeg download disabled by FFMPEG_AUTO_DOWNLOAD.')
    return
  }

  const projectRoot = process.cwd()
  const configured = resolveFfmpegPath({ projectRoot })
  if (commandWorks(configured)) {
    console.log(`[ffmpeg-setup] ffmpeg available: ${configured}`)
    return
  }

  try {
    const managedPath = await ensureManagedFfmpeg({ projectRoot })
    if (!commandWorks(managedPath)) throw new Error(`Downloaded ffmpeg could not be executed: ${managedPath}`)
    console.log(`[ffmpeg-setup] Managed ffmpeg ready: ${managedPath}`)
  } catch (error) {
    // Keep npm install usable in restricted/offline build environments. The scheduled
    // job retries the same verified download on demand before it reports a fatal error.
    console.warn(`[ffmpeg-setup] Warning: ${error?.message || error}`)
    console.warn('[ffmpeg-setup] The current-events job will retry setup on first execution. Set FFMPEG_PATH to an installed executable to disable that fallback.')
  }
}

await main()
