import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { v4 as uuidv4 } from 'uuid'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const ROUND_IMAGE_LIMIT = 3
export const TOURNAMENT_IMAGE_LIMIT = 8
export const MAX_STORED_IMAGE_BYTES = 520 * 1024
export const USER_IMAGE_ENTITY_TYPES = Object.freeze({
  SCORE: 'score',
  CHALLENGE: 'challenge',
  TOURNAMENT: 'tournament',
})

const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
})

export function userImagesDirectory() {
  const configured = String(process.env.USER_IMAGES_DIR || '').trim()
  return configured ? path.resolve(configured) : path.join(projectRoot, 'userimages')
}

export function ensureUserImagesDirectory() {
  const directory = userImagesDirectory()
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

export function decodeImageDataUrl(dataUrl) {
  const value = String(dataUrl || '')
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(value)
  if (!match) throw new Error('Image must be a JPEG, PNG, or WebP image.')
  const mimeType = match[1].toLowerCase()
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  if (!buffer.length) throw new Error('Image file is empty.')
  if (buffer.length > MAX_STORED_IMAGE_BYTES) throw new Error('Compressed image is too large. Please choose a smaller image.')
  const signatureMatches = mimeType === 'image/jpeg'
    ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : mimeType === 'image/png'
      ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!signatureMatches) throw new Error('Image file contents do not match the selected image type.')
  return { mimeType, buffer, extension: MIME_EXTENSIONS[mimeType] }
}

export function safeImageFilePath(fileName) {
  const normalized = path.basename(String(fileName || ''))
  if (!normalized || normalized !== String(fileName || '')) throw new Error('Invalid image file name.')
  return path.join(ensureUserImagesDirectory(), normalized)
}

function normalizeImageRow(row) {
  if (!row) return null
  return {
    id: String(row.id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    byteSize: Number(row.byte_size || 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    originalName: row.original_name || null,
    displayOrder: Number(row.display_order || 0),
    createdAt: row.created_at || null,
  }
}

export async function listUserImages(db, entityType, entityId) {
  const [rows] = await db.execute(
    `SELECT id, entity_type, entity_id, file_name, mime_type, byte_size, width, height,
            original_name, display_order, created_at
       FROM user_images
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY display_order ASC, created_at ASC, id ASC`,
    [entityType, String(entityId)],
  )
  return rows.map(normalizeImageRow)
}

export async function getUserImage(db, imageId) {
  const [rows] = await db.execute(
    `SELECT id, entity_type, entity_id, file_name, mime_type, byte_size, width, height,
            original_name, display_order, created_at
       FROM user_images
      WHERE id = ? LIMIT 1`,
    [String(imageId)],
  )
  return normalizeImageRow(rows[0])
}

export async function countUserImages(db, entityType, entityId) {
  const [[row = {}] = []] = await db.execute(
    'SELECT COUNT(*) AS imageCount FROM user_images WHERE entity_type = ? AND entity_id = ?',
    [entityType, String(entityId)],
  )
  return Number(row.imageCount || 0)
}

export async function getUserImageCounts(db, entityType, entityIds = []) {
  const ids = [...new Set(entityIds.map((value) => String(value || '').trim()).filter(Boolean))]
  const counts = new Map(ids.map((id) => [id, 0]))
  if (!ids.length) return counts
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await db.execute(
    `SELECT entity_id, COUNT(*) AS image_count
       FROM user_images
      WHERE entity_type = ? AND entity_id IN (${placeholders})
      GROUP BY entity_id`,
    [entityType, ...ids],
  )
  for (const row of rows) counts.set(String(row.entity_id), Number(row.image_count || 0))
  return counts
}

export async function saveUserImage(db, {
  entityType,
  entityId,
  dataUrl,
  originalName = null,
  width = null,
  height = null,
  uploadedByUserId = null,
  uploadedByEmail = null,
  uploadedByHostAccountId = null,
  correlationId = null,
  maxImages,
}) {
  const normalizedEntityId = String(entityId || '').trim()
  if (!normalizedEntityId) throw new Error('Image target is required.')
  const { mimeType, buffer, extension } = decodeImageDataUrl(dataUrl)
  const imageId = uuidv4()
  const fileName = `${imageId}.${extension}`
  const filePath = safeImageFilePath(fileName)
  const connection = await db.getConnection()
  let wroteFile = false
  try {
    await connection.beginTransaction()
    const [[countRow = {}] = []] = await connection.execute(
      'SELECT COUNT(*) AS imageCount FROM user_images WHERE entity_type = ? AND entity_id = ? FOR UPDATE',
      [entityType, normalizedEntityId],
    )
    if (Number(countRow.imageCount || 0) >= Number(maxImages)) {
      const error = new Error(`A maximum of ${maxImages} pictures is allowed.`)
      error.statusCode = 409
      throw error
    }
    const [[orderRow = {}] = []] = await connection.execute(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS nextOrder FROM user_images WHERE entity_type = ? AND entity_id = ?',
      [entityType, normalizedEntityId],
    )
    await fs.promises.writeFile(filePath, buffer, { flag: 'wx' })
    wroteFile = true
    await connection.execute(
      `INSERT INTO user_images
        (id, entity_type, entity_id, file_name, mime_type, byte_size, width, height, original_name,
         uploaded_by_user_id, uploaded_by_email, uploaded_by_host_account_id, correlation_id, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        imageId, entityType, normalizedEntityId, fileName, mimeType, buffer.length,
        Number.isFinite(Number(width)) && Number(width) > 0 ? Math.round(Number(width)) : null,
        Number.isFinite(Number(height)) && Number(height) > 0 ? Math.round(Number(height)) : null,
        String(originalName || '').trim().slice(0, 255) || null,
        uploadedByUserId || null,
        String(uploadedByEmail || '').trim().slice(0, 191) || null,
        uploadedByHostAccountId || null,
        String(correlationId || '').trim().slice(0, 191) || null,
        Number(orderRow.nextOrder || 0),
      ],
    )
    await connection.commit()
    return await getUserImage(db, imageId)
  } catch (error) {
    try { await connection.rollback() } catch (_) {}
    if (wroteFile) {
      try { await fs.promises.unlink(filePath) } catch (_) {}
    }
    throw error
  } finally {
    connection.release()
  }
}

export async function deleteUserImage(db, imageId) {
  const image = await getUserImage(db, imageId)
  if (!image) return null
  await db.execute('DELETE FROM user_images WHERE id = ?', [String(imageId)])
  try { await fs.promises.unlink(safeImageFilePath(image.fileName)) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return image
}
