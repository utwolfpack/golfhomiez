import crypto from 'crypto'
import { getPool } from '../db.js'
import { normalizeEmail } from './team-utils.js'

const ORGANIZER_SESSION_COOKIE = 'golfhomiez_organizer_session'
export const ORGANIZER_SESSION_TTL_MS = 1000 * 60 * 60 * 24

function getDb(source) {
  const candidates = [source?.app?.locals?.db, source?.app?.locals?.pool, source?.db, source?.pool, source, getPool()].filter(Boolean)
  for (const candidate of candidates) {
    if (typeof candidate.promise === 'function') return candidate.promise()
    if (candidate.pool && typeof candidate.pool.promise === 'function') return candidate.pool.promise()
    if (candidate.connection && typeof candidate.connection.promise === 'function') return candidate.connection.promise()
    if (typeof candidate.execute === 'function' && typeof candidate.query === 'function' && typeof candidate.getConnection !== 'function') return candidate
  }
  throw new Error('Promise-compatible database handle unavailable')
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(String(cookieHeader).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const idx = part.indexOf('=')
    return idx >= 0 ? [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))] : [part, '']
  }))
}

function randomId(len = 32) {
  return crypto.randomBytes(len).toString('hex').slice(0, len)
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function verifyPassword(password, stored) {
  if (!stored) return false
  const [scheme, salt, hash] = String(stored).split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

async function columnExists(db, tableName, columnName) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [tableName, columnName],
  )
  return rows.length > 0
}

async function ensureColumn(db, tableName, definitionStart) {
  const col = definitionStart.trim().split(/\s+/)[0].replace(/`/g, '')
  if (await columnExists(db, tableName, col)) return
  await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionStart}`)
}

async function getRbacHelpers() {
  return import('./rbac.js')
}

async function ensureIndex(db, tableName, indexName, ddl) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [tableName, indexName],
  )
  if (rows.length) return
  await db.query(ddl)
}

export async function ensureOrganizerAuthSchema(source) {
  const db = getDb(source)
  const { ensureTournamentInviteSchema } = await getRbacHelpers()
  await ensureTournamentInviteSchema(db)
  await ensureColumn(db, 'organizer_role_accounts', 'password_hash VARCHAR(255) NULL')
  await ensureColumn(db, 'organizer_role_accounts', 'reset_email VARCHAR(191) NULL')
  await db.query(`CREATE TABLE IF NOT EXISTS organizer_sessions (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    organizer_account_id VARCHAR(64) NOT NULL,
    token_hash VARCHAR(255) NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_organizer_sessions_account (organizer_account_id),
    INDEX idx_organizer_sessions_token_hash (token_hash),
    INDEX idx_organizer_sessions_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await ensureColumn(db, 'organizer_sessions', 'token_hash VARCHAR(255) NULL')
  await db.query("UPDATE organizer_sessions SET token_hash = SHA2(id, 256) WHERE token_hash IS NULL OR token_hash = ''")
  await ensureIndex(db, 'organizer_sessions', 'idx_organizer_sessions_token_hash', 'CREATE INDEX idx_organizer_sessions_token_hash ON organizer_sessions (token_hash)')
  await ensureIndex(db, 'organizer_sessions', 'idx_organizer_sessions_account', 'CREATE INDEX idx_organizer_sessions_account ON organizer_sessions (organizer_account_id)')
  await ensureIndex(db, 'organizer_sessions', 'idx_organizer_sessions_expires', 'CREATE INDEX idx_organizer_sessions_expires ON organizer_sessions (expires_at)')
  await ensureIndex(db, 'organizer_role_accounts', 'idx_organizer_role_accounts_email_direct', 'CREATE INDEX idx_organizer_role_accounts_email_direct ON organizer_role_accounts (email)')
  return true
}

function mapOrganizerAccount(row) {
  if (!row) return null
  return {
    id: row.id,
    roleAssignmentId: row.role_assignment_id || '',
    authUserId: row.auth_user_id || `organizer:${row.email}`,
    email: row.email,
    role: 'organizer',
    organizationName: row.organization_name || row.organizer_name || row.contact_name || row.email,
    contactName: row.contact_name || row.organization_name || row.organizer_name || row.email,
    phone: row.phone || null,
    websiteUrl: row.website_url || null,
    notes: row.notes || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export async function getOrganizerAccountByEmailDirect(source, email) {
  const db = getDb(source)
  await ensureOrganizerAuthSchema(db)
  const normalizedEmail = normalizeEmail(email)
  const [rows] = await db.execute(
    `SELECT ora.*, ura.auth_user_id, ura.email AS assignment_email
       FROM organizer_role_accounts ora
       LEFT JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id
      WHERE LOWER(COALESCE(ora.email, ura.email)) = ?
      LIMIT 1`,
    [normalizedEmail],
  )
  const row = rows[0]
  if (!row) return null
  return { ...row, email: row.email || row.assignment_email || normalizedEmail }
}

export async function getOrganizerAuthAccountByEmail(source, email) {
  return getOrganizerAccountByEmailDirect(source, email)
}

export async function registerOrganizerAccount(source, payload = {}) {
  const db = getDb(source)
  await ensureOrganizerAuthSchema(db)
  const email = normalizeEmail(payload.email)
  const password = String(payload.password || '')
  if (!email || !password) throw new Error('Email and password are required')
  const existing = await getOrganizerAccountByEmailDirect(db, email)
  if (existing?.password_hash) throw new Error('Organizer account already exists for this email')

  const user = {
    id: existing?.auth_user_id || `organizer:${email}`,
    email,
    name: `${String(payload.firstName || '').trim()} ${String(payload.lastName || '').trim()}`.replace(/\s+/g, ' ').trim() || email.split('@')[0],
  }
  const { ensureOrganizerAccountForInvitedUser } = await getRbacHelpers()
  const invitedAccount = await ensureOrganizerAccountForInvitedUser(db, user)
  if (!invitedAccount && !existing) throw new Error('A tournament invite is required before creating organizer access')
  const accountId = existing?.id || invitedAccount.id
  const organizationName = existing?.organization_name || existing?.organizer_name || invitedAccount?.organizationName || `${user.name} Organizer`
  const contactName = user.name
  await db.execute(
    `UPDATE organizer_role_accounts
        SET email = ?, auth_user_id = COALESCE(auth_user_id, ?), organization_name = COALESCE(organization_name, ?), contact_name = COALESCE(contact_name, ?), password_hash = ?, reset_email = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [email, user.id, organizationName, contactName, hashPassword(password), email, accountId],
  )
  return getOrganizerAccountByEmailDirect(db, email)
}

export async function authenticateOrganizerLogin(source, { email, password }) {
  const organizer = await getOrganizerAccountByEmailDirect(source, normalizeEmail(email))
  if (!organizer || !verifyPassword(password, organizer.password_hash)) return null
  return mapOrganizerAccount(organizer)
}

export async function createOrganizerSession(source, organizerAccountId) {
  const db = getDb(source)
  await ensureOrganizerAuthSchema(db)
  const sessionId = randomId(48)
  const expiresAt = new Date(Date.now() + ORGANIZER_SESSION_TTL_MS)
  await db.execute(
    'INSERT INTO organizer_sessions (id, organizer_account_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [sessionId, organizerAccountId, sha256(sessionId), expiresAt],
  )
  return { id: sessionId, organizerAccountId, expiresAt }
}

export function serializeOrganizerSessionCookie(sessionId) {
  const maxAge = Math.floor(ORGANIZER_SESSION_TTL_MS / 1000)
  return `${ORGANIZER_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

export function clearOrganizerSessionCookie() {
  return `${ORGANIZER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export async function destroyOrganizerSession(source, sessionId) {
  const db = getDb(source)
  if (!sessionId) return
  await db.execute('DELETE FROM organizer_sessions WHERE token_hash = ?', [sha256(sessionId)])
}


export async function refreshOrganizerSessionExpiry(source, sessionId) {
  const db = getDb(source)
  if (!sessionId) return
  await db.execute(
    'UPDATE organizer_sessions SET expires_at = ? WHERE token_hash = ?',
    [new Date(Date.now() + ORGANIZER_SESSION_TTL_MS), sha256(sessionId)],
  )
}

export async function getOrganizerAccountBySession(source, sessionId) {
  const db = getDb(source)
  if (!sessionId) return null
  await ensureOrganizerAuthSchema(db)
  const [rows] = await db.execute(
    `SELECT ora.*, ura.auth_user_id, ura.email AS assignment_email
       FROM organizer_sessions s
       JOIN organizer_role_accounts ora ON ora.id = s.organizer_account_id
       LEFT JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id
      WHERE s.token_hash = ? AND s.expires_at > NOW()
      LIMIT 1`,
    [sha256(sessionId)],
  )
  const row = rows[0]
  const organizerAccount = mapOrganizerAccount(row ? { ...row, email: row.email || row.assignment_email } : null)
  if (organizerAccount) await refreshOrganizerSessionExpiry(source, sessionId)
  return organizerAccount
}

export async function organizerAuthMiddleware(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || '')
    const sessionId = cookies[ORGANIZER_SESSION_COOKIE]
    const organizerAccount = await getOrganizerAccountBySession(req, sessionId)
    if (!organizerAccount) return res.status(401).json({ message: 'Organizer authentication required' })
    req.organizerAccount = organizerAccount
    req.organizerSessionId = sessionId
    req.organizerUser = { id: organizerAccount.authUserId, email: organizerAccount.email, name: organizerAccount.contactName || organizerAccount.organizationName }
    res.setHeader('Set-Cookie', serializeOrganizerSessionCookie(sessionId))
    return next()
  } catch (error) {
    return next(error)
  }
}
