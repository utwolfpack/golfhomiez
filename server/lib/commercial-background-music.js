import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const COMMERCIAL_BACKGROUND_MUSIC_NAME = 'Golf Homiez for Golf Courses'
export const COMMERCIAL_BACKGROUND_MUSIC_RELATIVE_PATH = 'server/assets/golf-homiez-for-golf-courses-background.m4a'
export const DEFAULT_COMMERCIAL_BACKGROUND_MUSIC_VOLUME = 0.12
const moduleProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function commercialBackgroundMusicVolume(value = process.env.COMMERCIAL_BACKGROUND_MUSIC_VOLUME) {
  if (value == null || String(value).trim() === '') return DEFAULT_COMMERCIAL_BACKGROUND_MUSIC_VOLUME
  const parsed = Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return DEFAULT_COMMERCIAL_BACKGROUND_MUSIC_VOLUME
  return Math.min(0.35, Math.max(0.02, parsed))
}

export async function resolveCommercialBackgroundMusicFile({
  configuredPath = process.env.COMMERCIAL_BACKGROUND_MUSIC_FILE || null,
  projectRoot = process.cwd(),
} = {}) {
  const candidates = [
    configuredPath ? path.resolve(projectRoot, configuredPath) : null,
    path.resolve(projectRoot, COMMERCIAL_BACKGROUND_MUSIC_RELATIVE_PATH),
    path.resolve(moduleProjectRoot, COMMERCIAL_BACKGROUND_MUSIC_RELATIVE_PATH),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile() && stat.size > 0) return candidate
    } catch {
      // Continue to the bundled GolfHomiez track.
    }
  }

  const error = new Error(`Commercial background music is unavailable. Expected ${COMMERCIAL_BACKGROUND_MUSIC_RELATIVE_PATH} or COMMERCIAL_BACKGROUND_MUSIC_FILE.`)
  error.code = 'COMMERCIAL_BACKGROUND_MUSIC_MISSING'
  throw error
}

export function backgroundMusicMetadata(filePath, volume = DEFAULT_COMMERCIAL_BACKGROUND_MUSIC_VOLUME) {
  return {
    name: COMMERCIAL_BACKGROUND_MUSIC_NAME,
    fileName: filePath ? path.basename(filePath) : path.basename(COMMERCIAL_BACKGROUND_MUSIC_RELATIVE_PATH),
    volume,
  }
}
