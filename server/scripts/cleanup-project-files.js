import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')
const docsDir = path.join(projectRoot, 'docs')

export const DOC_FILES_TO_MOVE = [
  'AUTH_TTL_LOGGING_DIRECTIONS.md',
  'BREVO-SMTP.md',
  'DOCKER-README.md',
  'FEATURE_FLAG_FRAMEWORK_DIRECTIONS.md',
  'GOLFBERT_API_IMPLEMENTATION_DIRECTIONS.md',
  'IGOLF_API_IMPLEMENTATION_DIRECTIONS.md',
  'ORGANIZER_FORGOT_PASSWORD_LINK_DIRECTIONS.md',
  'PromptGuide.md',
  'README.md',
  'failtest062226.md',
]

export const ORPHANED_FILES_TO_REMOVE = [
  'LocationInput.tsx',
  'index.js',
  'app.test.js.patch',
  'README.txt',
  'README_IGOLF_CHANGESET.txt',
  'cleanup/remove_obsolete_readmes.txt',
  'mnt/data/REMOVED_PATCH_FILES.txt',
  'tsconfig.tsbuildinfo',
]

function safePath(relativePath) {
  const targetPath = path.resolve(projectRoot, relativePath)
  if (!targetPath.startsWith(projectRoot + path.sep) && targetPath !== projectRoot) {
    throw new Error(`Refusing to modify path outside the project: ${relativePath}`)
  }
  return targetPath
}

function ensureDocsDir() {
  fs.mkdirSync(docsDir, { recursive: true })
}

function moveInformationalDocs() {
  ensureDocsDir()
  for (const fileName of DOC_FILES_TO_MOVE) {
    const sourcePath = safePath(fileName)
    const targetPath = safePath(path.join('docs', fileName))
    if (!fs.existsSync(sourcePath)) continue
    fs.copyFileSync(sourcePath, targetPath)
    fs.rmSync(sourcePath, { force: true })
  }
}

function removeOrphanedFiles() {
  for (const relativePath of ORPHANED_FILES_TO_REMOVE) {
    const targetPath = safePath(relativePath)
    fs.rmSync(targetPath, { force: true, recursive: false })
  }

  for (const relativeDir of ['mnt/data', 'mnt', 'cleanup']) {
    const targetDir = safePath(relativeDir)
    try {
      if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length === 0) fs.rmdirSync(targetDir)
    } catch {
      // Non-empty folders are intentionally left in place.
    }
  }
}

export function cleanupProjectFiles() {
  moveInformationalDocs()
  removeOrphanedFiles()
}

cleanupProjectFiles()
console.log('Project documentation and orphaned-file cleanup completed.')
