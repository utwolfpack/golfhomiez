import crypto from 'node:crypto'
import { getPool } from '../db.js'
import { sendMail } from '../mailer.js'
import { normalizeEmail, isEmail } from './team-utils.js'
import { ensureHostAuthSchema } from './host-auth.js'

const ADMIN_COOKIE = 'golf_admin_session'
export const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 24
const ADMIN_EMAIL_FROM = 'GolfHomiez Admin <no-reply@golfhomiez.com>'
const ADMIN_RESET_ROUTE = '/golfadmin/reset-password'
const ADMIN_LOGIN_ROUTE = '/golfadmin'
const HOST_LOGIN_ROUTE = '/host/login'
const HOST_ACCOUNT_REQUEST_NOTIFICATION_EMAIL = 'golfhomiez@outlook.com'

function hashHostAccountPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function pool() {
  return getPool()
}

let adminSchemaReady = false

function escapeSqlString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\'")
}

function escapeIdentifier(value) {
  return `\`${String(value || '').replace(/\`/g, '\\`')}\``
}

async function tableExists(name) {
  const [rows] = await pool().query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '${escapeSqlString(name)}'
      LIMIT 1`
  )
  return Array.isArray(rows) && rows.length > 0
}

async function columnExists(tableName, columnName) {
  const [rows] = await pool().query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '${escapeSqlString(tableName)}'
        AND COLUMN_NAME = '${escapeSqlString(columnName)}'
      LIMIT 1`
  )
  return Array.isArray(rows) && rows.length > 0
}

async function constraintExists(tableName, constraintName) {
  const [rows] = await pool().execute(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ?`,
    [tableName, constraintName],
  )
  return Array.isArray(rows) && rows.length > 0
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool().execute(
    `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?`,
    [tableName, indexName],
  )
  return Array.isArray(rows) && rows.length > 0
}

async function getTableColumns(tableName) {
  const [rows] = await pool().execute(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName],
  )
  return new Set((rows || []).map((row) => String(row.COLUMN_NAME || row.column_name || '')))
}

async function addColumnIfMissing(tableName, columnName, definition, options = {}) {
  const columns = await getTableColumns(tableName)
  if (columns.has(columnName)) return
  try {
    await pool().query(`ALTER TABLE ${escapeIdentifier(tableName)} ADD COLUMN ${escapeIdentifier(columnName)} ${definition}`)
  } catch (error) {
    if (!options.ignoreDuplicate || String(error?.code || '') !== 'ER_DUP_FIELDNAME') throw error
  }
}

async function ensureHostAccountRequestTableCompatibility() {
  if (!await tableExists('host_account_requests')) return

  await addColumnIfMissing('host_account_requests', 'state_code', "VARCHAR(32) NOT NULL DEFAULT ''", { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'state_name', "VARCHAR(191) NOT NULL DEFAULT ''", { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'location_label', "VARCHAR(191) NOT NULL DEFAULT ''", { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'requested_password_hash', 'VARCHAR(255) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'reviewed_by_admin_id', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'reviewed_by_email', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'reviewed_at', 'DATETIME NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'approved_host_account_id', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', { ignoreDuplicate: true })

  if (!await indexExists('host_account_requests', 'idx_host_account_requests_status_created')) {
    await pool().query('CREATE INDEX idx_host_account_requests_status_created ON host_account_requests (status, created_at)')
  }
  if (!await indexExists('host_account_requests', 'idx_host_account_requests_email')) {
    await pool().query('CREATE INDEX idx_host_account_requests_email ON host_account_requests (email)')
  }
}

function getAppBaseUrl() {
  const explicit =
    process.env.APP_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.PUBLIC_WEB_URL ||
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.VITE_APP_URL ||
    ''

  const trimmed = String(explicit || '').trim()
  return trimmed ? trimmed.replace(/\/$/, '') : (process.env.CLIENT_ORIGIN || process.env.BETTER_AUTH_URL || '')
}

function buildHostLoginUrl() {
  const base = getAppBaseUrl()
  return new URL(HOST_LOGIN_ROUTE, `${base}/`).toString()
}

function createTemporaryPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

async function sendHostAccountRequestNotification({ firstName, lastName, email, stateName, golfCourseName, representativeDetails }) {
  const adminPortalUrl = new URL('/golfadmin', `${getAppBaseUrl()}/`).toString()
  const subject = `Golf Course Account Request ${golfCourseName}`
  const text = [
    'A new Golf Homiez golf-course account request has been submitted.',
    '',
    `First name: ${firstName}`,
    `Last name: ${lastName}`,
    `Email: ${email}`,
    `Location: ${stateName}`,
    `Representative details: ${representativeDetails}`,
    `Golf admin: ${adminPortalUrl}`,
  ].join('\n')

  const html = `
    <p>A new Golf Homiez golf-course account request has been submitted.</p>
    <p><strong>First name:</strong> ${firstName}<br />
    <strong>Last name:</strong> ${lastName}<br />
    <strong>Email:</strong> ${email}<br />
    <strong>Location:</strong> ${stateName}<br />
    <strong>Representative details:</strong> ${representativeDetails}</p>
    <p><a href="${adminPortalUrl}">Open the golf admin portal</a></p>
  `

  await sendMail({
    to: HOST_ACCOUNT_REQUEST_NOTIFICATION_EMAIL,
    subject,
    text,
    html,
  })
}

async function sendHostAccountApprovalEmail({ email, firstName, golfCourseName }) {
  const hostLoginUrl = buildHostLoginUrl()
  const greetingName = String(firstName || '').trim() || 'there'
  const subject = `Your Golf Homiez golf-course account for ${golfCourseName} has been approved`
  const text = [
    `Hello ${greetingName},`,
    '',
    'Your Golf Homiez golf-course account has been approved. You can login to your account here:',
    hostLoginUrl,
    '',
    `We are excited to welcome ${golfCourseName} to GolfHomiez. Thank you for taking the time to request access and help represent your course in the community. We appreciate your interest and look forward to having you on GolfHomiez.`,
  ].join('\n')

  const html = `
    <p>Hello ${greetingName},</p>
    <p>Your Golf Homiez golf-course account has been approved. You can login to your account <a href="${hostLoginUrl}">here</a>.</p>
    <p>We are excited to welcome <strong>${golfCourseName}</strong> to GolfHomiez. Thank you for taking the time to request access and help represent your course in the community. We appreciate your interest and look forward to having you on GolfHomiez.</p>
  `

  await sendMail({
    to: email,
    subject,
    text,
    html,
  })
}

async function createOrUpdateApprovedHostAccount({ email, golfCourseName, passwordHash = null }) {
  await ensureHostAuthSchema(pool())
  const db = pool()
  const normalizedEmail = normalizeEmail(email)
  const normalizedGolfCourseName = String(golfCourseName || '').trim()
  const [existingRows] = await db.execute('SELECT id FROM host_accounts WHERE email = ? LIMIT 1', [normalizedEmail])
  const existing = existingRows[0]
  const columns = await getTableColumns('host_accounts')
  const nameColumns = ['golf_course_name', 'account_name', 'course_name', 'name'].filter((columnName) => columns.has(columnName))

  if (existing?.id) {
    const assignments = []
    const params = []
    if (columns.has('auth_user_id')) {
      assignments.push('auth_user_id = ?')
      params.push(`host:${normalizedEmail}`)
    }
    if (columns.has('reset_email')) {
      assignments.push('reset_email = ?')
      params.push(normalizedEmail)
    }
    if (columns.has('password_hash') && passwordHash) {
      assignments.push('password_hash = ?')
      params.push(passwordHash)
    }
    if (columns.has('is_validated')) assignments.push('is_validated = 1')
    if (columns.has('validated_at')) assignments.push('validated_at = UTC_TIMESTAMP()')
    for (const columnName of nameColumns) {
      assignments.push(`${escapeIdentifier(columnName)} = ?`)
      params.push(normalizedGolfCourseName)
    }
    if (columns.has('updated_at')) assignments.push('updated_at = CURRENT_TIMESTAMP')
    if (assignments.length) {
      params.push(existing.id)
      await db.execute(`UPDATE host_accounts SET ${assignments.join(', ')} WHERE id = ?`, params)
    }
    return existing.id
  }

  const hostAccountId = crypto.randomUUID().replace(/-/g, '')
  const resolvedPasswordHash = passwordHash || createTemporaryPasswordHash(crypto.randomBytes(24).toString('hex'))
  const insertColumns = ['id']
  const insertValues = ['?']
  const insertParams = [hostAccountId]

  if (columns.has('email')) {
    insertColumns.push('email')
    insertValues.push('?')
    insertParams.push(normalizedEmail)
  }
  if (columns.has('auth_user_id')) {
    insertColumns.push('auth_user_id')
    insertValues.push('?')
    insertParams.push(`host:${normalizedEmail}`)
  }
  if (columns.has('password_hash')) {
    insertColumns.push('password_hash')
    insertValues.push('?')
    insertParams.push(resolvedPasswordHash)
  }
  if (columns.has('reset_email')) {
    insertColumns.push('reset_email')
    insertValues.push('?')
    insertParams.push(normalizedEmail)
  }
  if (columns.has('invite_id')) {
    insertColumns.push('invite_id')
    insertValues.push('?')
    insertParams.push(`approved-request:${hostAccountId}`)
  }
  if (columns.has('is_validated')) {
    insertColumns.push('is_validated')
    insertValues.push('1')
  }
  if (columns.has('validated_at')) {
    insertColumns.push('validated_at')
    insertValues.push('UTC_TIMESTAMP()')
  }
  for (const columnName of nameColumns) {
    insertColumns.push(columnName)
    insertValues.push('?')
    insertParams.push(normalizedGolfCourseName)
  }

  await db.execute(
    `INSERT INTO host_accounts (${insertColumns.map((columnName) => escapeIdentifier(columnName)).join(', ')}) VALUES (${insertValues.join(', ')})`,
    insertParams,
  )
  return hostAccountId
}

async function ensureAdminPortalSchema() {
  if (adminSchemaReady) return
  const db = pool()
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id VARCHAR(191) PRIMARY KEY,
      username VARCHAR(191) NOT NULL UNIQUE,
      email VARCHAR(191) NOT NULL UNIQUE,
      password_salt VARCHAR(191) NOT NULL,
      password_hash VARCHAR(191) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
      id VARCHAR(191) PRIMARY KEY,
      admin_user_id VARCHAR(191) NOT NULL,
      token_hash VARCHAR(191) NOT NULL,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admin_password_reset_lookup (admin_user_id, expires_at),
      CONSTRAINT fk_admin_password_reset_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `)

await db.query(`
  CREATE TABLE IF NOT EXISTS host_account_requests (
    id VARCHAR(191) PRIMARY KEY,
    first_name VARCHAR(191) NOT NULL,
    last_name VARCHAR(191) NOT NULL,
    email VARCHAR(191) NOT NULL,
    state_code VARCHAR(32) NOT NULL,
    state_name VARCHAR(191) NOT NULL,
    golf_course_name VARCHAR(191) NOT NULL,
    representative_details TEXT NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'pending',
    reviewed_by_admin_id VARCHAR(191) NULL,
    reviewed_by_email VARCHAR(191) NULL,
    reviewed_at DATETIME NULL,
    approved_host_account_id VARCHAR(191) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_host_account_requests_status_created (status, created_at),
    INDEX idx_host_account_requests_email (email)
  )
`)
  await ensureHostAccountRequestTableCompatibility()

  await db.query(`
    CREATE TABLE IF NOT EXISTS host_accounts (
      id VARCHAR(191) PRIMARY KEY,
      auth_user_id VARCHAR(191) NOT NULL UNIQUE,
      email VARCHAR(191) NOT NULL UNIQUE,
      account_name VARCHAR(191) NOT NULL,
      invite_id VARCHAR(191) NOT NULL,
      is_validated TINYINT(1) NOT NULL DEFAULT 0,
      validated_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_host_accounts_name (account_name),
      INDEX idx_host_accounts_invite_id (invite_id)
    )
  `)

  if (await tableExists('host_accounts') && !await columnExists('host_accounts', 'is_validated')) {
    await db.query('ALTER TABLE host_accounts ADD COLUMN is_validated TINYINT(1) NOT NULL DEFAULT 0 AFTER invite_id')
  }

  if (await tableExists('host_accounts') && !await columnExists('host_accounts', 'validated_at')) {
    await db.query('ALTER TABLE host_accounts ADD COLUMN validated_at DATETIME NULL AFTER is_validated')
  }

  if (await tableExists('host_accounts') && await constraintExists('host_accounts', 'fk_host_accounts_invite')) {
    await db.query('ALTER TABLE host_accounts DROP FOREIGN KEY fk_host_accounts_invite')
  }

  if (await tableExists('host_accounts') && !await columnExists('host_accounts', 'invite_id')) {
    await db.query('ALTER TABLE host_accounts ADD COLUMN invite_id VARCHAR(191) NOT NULL DEFAULT "" AFTER account_name')
  }

  if (await tableExists('host_accounts') && !await indexExists('host_accounts', 'idx_host_accounts_invite_id')) {
    try {
      await db.query('CREATE INDEX idx_host_accounts_invite_id ON host_accounts (invite_id)')
    } catch {}
  }

  await db.execute(
    `INSERT INTO admin_users (id, username, email, password_salt, password_hash, is_active)
     SELECT ?, ?, ?, ?, ?, 1
     WHERE NOT EXISTS (SELECT 1 FROM admin_users WHERE username = ?)` ,
    [
      'default_admin_account',
      'admin',
      'no-reply@golfhomiez.com',
      'f1a2f0f1c6d44906a4dd4d16d4f7a355',
      '76455f08f5e7d764dd091333137ccb199b9537fa3a303050973b6135debf6741',
      'admin',
    ],
  )

  adminSchemaReady = true
}

export function getAdminEmailFrom() {
  return ADMIN_EMAIL_FROM
}

function hmacSecret() {
  return String(process.env.ADMIN_SESSION_SECRET || process.env.BETTER_AUTH_SECRET || 'golfhomiez-admin-secret').trim()
}

function hashSecret(salt, password) {
  return crypto.createHash('sha256').update(`${salt}:${String(password || '')}`).digest('hex')
}

export function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return { salt, hash: hashSecret(salt, password) }
}

export function verifyPassword(password, salt, hash) {
  const expected = Buffer.from(hashSecret(salt, password))
  const actual = Buffer.from(String(hash || ''))
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function signAdminToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', hmacSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyAdminToken(token) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', hmacSecret()).update(body).digest('base64url')
  if (sig !== expected) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!payload?.adminUserId || !payload?.exp || Date.now() > Number(payload.exp)) return null
    return payload
  } catch {
    return null
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header || '').split(/;\s*/).filter(Boolean).map((part) => {
    const idx = part.indexOf('=')
    if (idx < 0) return [part, '']
    return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))]
  }))
}

export function createAdminSessionCookie(adminUser) {
  const maxAgeMs = ADMIN_SESSION_TTL_MS
  const token = signAdminToken({ adminUserId: adminUser.id, username: adminUser.username, exp: Date.now() + maxAgeMs })
  const parts = [
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ]
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') parts.push('Secure')
  return parts.join('; ')
}

export function clearAdminSessionCookie() {
  const parts = [`${ADMIN_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') parts.push('Secure')
  return parts.join('; ')
}

export async function getAdminUserByUsername(username) {
  await ensureAdminPortalSchema()
  const identifier = String(username || '').trim().toLowerCase()
  const [rows] = await pool().execute(
    `SELECT id, username, email, password_salt, password_hash, is_active, created_at, updated_at
       FROM admin_users
      WHERE username = ? OR email = ?
      LIMIT 1`,
    [identifier, identifier],
  )
  return rows[0] || null
}

export async function getAdminUserById(id) {
  await ensureAdminPortalSchema()
  const [rows] = await pool().execute(
    `SELECT id, username, email, is_active, created_at, updated_at
       FROM admin_users
      WHERE id = ?
      LIMIT 1`,
    [id],
  )
  return rows[0] || null
}

export async function authenticateAdminRequest(req) {
  const token = parseCookies(req.headers.cookie || '')[ADMIN_COOKIE]
  const payload = verifyAdminToken(token)
  if (!payload) return null
  const adminUser = await getAdminUserById(payload.adminUserId)
  if (!adminUser || !Number(adminUser.is_active)) return null
  return adminUser
}

export function refreshAdminSessionCookie(adminUser) {
  return createAdminSessionCookie(adminUser)
}

export function getPortalUrls(req) {
  const origin = process.env.CLIENT_ORIGIN || `${req.protocol}://${req.get('host')}`
  return {
    adminLoginUrl: new URL(ADMIN_LOGIN_ROUTE, origin).toString(),
    adminResetUrl: new URL(ADMIN_RESET_ROUTE, origin).toString(),
  }
}

export async function createAdminUser({ username, email, password }) {
  await ensureAdminPortalSchema()
  const normalizedUsername = String(username || '').trim().toLowerCase()
  const normalized = normalizeEmail(email)
  if (!normalizedUsername) throw new Error('Username is required.')
  if (!isEmail(normalized)) throw new Error('A valid email is required.')
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.')
  const id = crypto.randomUUID().replace(/-/g, '')
  const { salt, hash } = createPasswordRecord(password)
  await pool().execute(
    `INSERT INTO admin_users (id, username, email, password_salt, password_hash, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [id, normalizedUsername, normalized, salt, hash],
  )
  return getAdminUserById(id)
}

export async function listAdminUsers() {
  await ensureAdminPortalSchema()
  const [rows] = await pool().query(
    `SELECT id, username, email, is_active, created_at, updated_at
       FROM admin_users
      ORDER BY created_at ASC`,
  )
  return rows
}

export async function deleteAdminUser({ adminUserId, requestedByAdminUserId }) {
  await ensureAdminPortalSchema()
  const targetId = String(adminUserId || '').trim()
  if (!targetId) throw new Error('Admin user id is required.')
  if (targetId === String(requestedByAdminUserId || '').trim()) {
    throw new Error('You cannot delete your own admin account.')
  }

  const [rows] = await pool().execute(
    `SELECT id, username, email, is_active, created_at, updated_at
       FROM admin_users
      WHERE id = ?
      LIMIT 1`,
    [targetId],
  )
  const target = rows[0]
  if (!target) throw new Error('Admin user not found.')

  if (Number(target.is_active)) {
    const [[{ activeCount = 0 } = {}]] = await pool().query('SELECT COUNT(*) AS activeCount FROM admin_users WHERE is_active = 1')
    if (Number(activeCount) <= 1) throw new Error('You cannot delete the last active admin account.')
  }

  await pool().execute('DELETE FROM admin_users WHERE id = ?', [targetId])
  return { deleted: true, adminUser: target }
}

export async function createAdminResetToken(adminUserId) {
  await ensureAdminPortalSchema()
  const raw = crypto.randomBytes(24).toString('hex')
  const tokenHash = sha256(raw)
  const id = crypto.randomUUID().replace(/-/g, '')
  await pool().execute(
    `INSERT INTO admin_password_reset_tokens (id, admin_user_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 60 MINUTE))`,
    [id, adminUserId, tokenHash],
  )
  return raw
}

export async function consumeAdminResetToken(rawToken, nextPassword) {
  await ensureAdminPortalSchema()
  const tokenHash = sha256(rawToken)
  const [rows] = await pool().execute(
    `SELECT id, admin_user_id
       FROM admin_password_reset_tokens
      WHERE token_hash = ?
        AND consumed_at IS NULL
        AND expires_at > UTC_TIMESTAMP()
      ORDER BY created_at DESC
      LIMIT 1`,
    [tokenHash],
  )
  const row = rows[0]
  if (!row) throw new Error('Reset token is invalid or expired.')
  const { salt, hash } = createPasswordRecord(nextPassword)
  await pool().execute(`UPDATE admin_users SET password_salt = ?, password_hash = ? WHERE id = ?`, [salt, hash, row.admin_user_id])
  await pool().execute(`UPDATE admin_password_reset_tokens SET consumed_at = UTC_TIMESTAMP() WHERE id = ?`, [row.id])
  return getAdminUserById(row.admin_user_id)
}

export async function createHostAccountRequest({ firstName, lastName, email, stateCode, stateName, golfCourseName, representativeDetails, password }) {
  await ensureAdminPortalSchema()
  const normalizedEmail = normalizeEmail(email)
  if (!isEmail(normalizedEmail)) throw new Error('A valid email address is required.')
  const normalizedFirstName = String(firstName || '').trim()
  const normalizedLastName = String(lastName || '').trim()
  const normalizedStateCode = String(stateCode || '').trim().toUpperCase()
  const normalizedStateName = String(stateName || '').trim()
  const normalizedGolfCourseName = String(golfCourseName || '').trim()
  const normalizedRepresentativeDetails = String(representativeDetails || '').trim()
  const normalizedPassword = String(password || '')

  if (!normalizedFirstName) throw new Error('First name is required.')
  if (!normalizedLastName) throw new Error('Last name is required.')
  if (!normalizedStateCode) throw new Error('State is required.')
  if (!normalizedStateName) throw new Error('State is required.')
  if (!normalizedGolfCourseName) throw new Error('Golf course is required.')
  if (!normalizedRepresentativeDetails) throw new Error('Representative details are required.')
  if (normalizedPassword.length < 8) throw new Error('Password must be at least 8 characters.')

  const id = crypto.randomUUID().replace(/-/g, '')
  const requestColumns = await getTableColumns('host_account_requests')
  const insertMap = new Map()
  insertMap.set('id', id)
  if (requestColumns.has('first_name')) insertMap.set('first_name', normalizedFirstName)
  if (requestColumns.has('last_name')) insertMap.set('last_name', normalizedLastName)
  if (requestColumns.has('email')) insertMap.set('email', normalizedEmail)
  if (requestColumns.has('state_code')) insertMap.set('state_code', normalizedStateCode)
  if (requestColumns.has('state_name')) insertMap.set('state_name', normalizedStateName)
  if (requestColumns.has('location_label')) insertMap.set('location_label', normalizedStateName)
  if (requestColumns.has('golf_course_name')) insertMap.set('golf_course_name', normalizedGolfCourseName)
  if (requestColumns.has('representative_details')) insertMap.set('representative_details', normalizedRepresentativeDetails)
  if (requestColumns.has('requested_password_hash')) insertMap.set('requested_password_hash', hashHostAccountPassword(normalizedPassword))
  if (requestColumns.has('status')) insertMap.set('status', 'pending')

  const insertColumns = [...insertMap.keys()]
  const placeholders = insertColumns.map(() => '?')
  await pool().execute(
    `INSERT INTO host_account_requests (${insertColumns.map((columnName) => escapeIdentifier(columnName)).join(', ')}) VALUES (${placeholders.join(', ')})`,
    [...insertMap.values()],
  )

  await sendHostAccountRequestNotification({
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    email: normalizedEmail,
    stateName: normalizedStateName,
    golfCourseName: normalizedGolfCourseName,
    representativeDetails: normalizedRepresentativeDetails,
  })

  return {
    id,
    status: 'pending',
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    email: normalizedEmail,
    stateCode: normalizedStateCode,
    stateName: normalizedStateName,
    golfCourseName: normalizedGolfCourseName,
    representativeDetails: normalizedRepresentativeDetails,
  }
}

export async function approveHostAccountRequest({ requestId, adminUserId, adminEmail = '' }) {
  await ensureAdminPortalSchema()
  const [requestRows] = await pool().execute(
    `SELECT *
       FROM host_account_requests
      WHERE id = ?
      LIMIT 1`,
    [requestId],
  )
  const request = requestRows[0]
  if (!request) throw new Error('Golf-course account request not found.')
  if (String(request.status || '').toLowerCase() !== 'pending') {
    throw new Error('Golf-course account request has already been reviewed.')
  }

  const hostAccountId = await createOrUpdateApprovedHostAccount({
    email: request.email,
    golfCourseName: request.golf_course_name,
    passwordHash: request.requested_password_hash || null,
  })

  await pool().execute(
    `UPDATE host_account_requests
        SET status = 'approved',
            reviewed_by_admin_id = ?,
            reviewed_by_email = ?,
            reviewed_at = UTC_TIMESTAMP(),
            approved_host_account_id = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [adminUserId, String(adminEmail || '').trim() || null, hostAccountId, requestId],
  )

  await sendHostAccountApprovalEmail({
    email: request.email,
    firstName: request.first_name,
    golfCourseName: request.golf_course_name,
  })

  const [updatedRows] = await pool().execute(
    `SELECT *
       FROM host_account_requests
      WHERE id = ?
      LIMIT 1`,
    [requestId],
  )

  return {
    request: updatedRows[0] || null,
    hostAccountId,
    approved: true,
  }
}


export async function deleteHostAccountRequest({ requestId, adminUserId, adminEmail = '' }) {
  await ensureAdminPortalSchema()
  const [requestRows] = await pool().execute(
    `SELECT *
       FROM host_account_requests
      WHERE id = ?
      LIMIT 1`,
    [requestId],
  )
  const request = requestRows[0]
  if (!request) throw new Error('Golf-course account request not found.')
  if (String(request.status || '').toLowerCase() !== 'pending') {
    throw new Error('Only pending golf-course account requests can be deleted.')
  }

  await pool().execute(
    `DELETE FROM host_account_requests
      WHERE id = ?`,
    [requestId],
  )

  return {
    deleted: true,
    requestId,
    reviewedByAdminId: adminUserId,
    reviewedByEmail: String(adminEmail || '').trim() || null,
  }
}

export async function listPortalData() {
  await ensureAdminPortalSchema()
  const db = pool()
  const [[{ userCount = 0 } = {}]] = await db.query('SELECT COUNT(*) AS userCount FROM `user`')
  const [[{ appUserCount = 0 } = {}]] = await db.query('SELECT COUNT(*) AS appUserCount FROM app_users')
  const [[{ teamCount = 0 } = {}]] = await db.query('SELECT COUNT(*) AS teamCount FROM teams')
  const [[{ scoreCount = 0 } = {}]] = await db.query('SELECT COUNT(*) AS scoreCount FROM scores')
  const [[{ hostCount = 0 } = {}]] = await db.query('SELECT COUNT(*) AS hostCount FROM host_accounts')
  const [[{ organizerCount = 0 } = {}]] = await db.query('SELECT COUNT(*) AS organizerCount FROM organizer_role_accounts')
  const [[{ tournamentCount = 0 } = {}]] = await db.query('SELECT COUNT(*) AS tournamentCount FROM tournaments')
  const [[{ hostAccountRequestCount = 0 } = {}]] = await db.query("SELECT COUNT(*) AS hostAccountRequestCount FROM host_account_requests WHERE status = 'pending'")

  const selectColumn = (columns, tableAlias, candidates, alias, fallback = 'NULL') => {
    const columnName = candidates.find((candidate) => columns.has(candidate))
    return columnName
      ? `${tableAlias}.${escapeIdentifier(columnName)} AS ${escapeIdentifier(alias)}`
      : `${fallback} AS ${escapeIdentifier(alias)}`
  }
  const nullableColumnRef = (columns, tableAlias, columnName) => columns.has(columnName) ? `NULLIF(${tableAlias}.${escapeIdentifier(columnName)}, '')` : null

  const hostColumns = await getTableColumns('host_accounts')
  const organizerColumns = await getTableColumns('organizer_role_accounts')
  const appUserColumns = await getTableColumns('app_users')
  const teamColumns = await getTableColumns('teams')
  const teamMemberColumns = await getTableColumns('team_members')
  const scoreColumns = await getTableColumns('scores')
  const tournamentColumns = await getTableColumns('tournaments')
  const hostRoleColumns = await getTableColumns('host_role_accounts')
  const requestColumns = await getTableColumns('host_account_requests')

  const requestStateCodeColumn = requestColumns.has('state_code') ? 'state_code' : null
  const requestStateNameColumn = requestColumns.has('state_name') ? 'state_name' : null
  const requestReviewedByEmailColumn = requestColumns.has('reviewed_by_email') ? 'reviewed_by_email' : null
  const requestReviewedAtColumn = requestColumns.has('reviewed_at') ? 'reviewed_at' : null
  const requestApprovedHostAccountIdColumn = requestColumns.has('approved_host_account_id') ? 'approved_host_account_id' : null

  const admins = await listAdminUsers()
  const [hosts] = await db.query(`SELECT ${[
    selectColumn(hostColumns, 'ha', ['id'], 'id'),
    selectColumn(hostColumns, 'ha', ['email'], 'email'),
    selectColumn(hostColumns, 'ha', ['account_name', 'golf_course_name', 'course_name', 'name'], 'account_name'),
    selectColumn(hostColumns, 'ha', ['contact_name'], 'contact_name'),
    selectColumn(hostColumns, 'ha', ['phone'], 'phone'),
    selectColumn(hostColumns, 'ha', ['notes'], 'notes'),
    selectColumn(hostColumns, 'ha', ['is_validated'], 'is_validated'),
    selectColumn(hostColumns, 'ha', ['validated_at'], 'validated_at'),
    selectColumn(hostColumns, 'ha', ['created_at'], 'created_at'),
    selectColumn(hostColumns, 'ha', ['updated_at'], 'updated_at'),
  ].join(', ')} FROM host_accounts ha ORDER BY ha.created_at DESC LIMIT 50`)
  const [organizers] = await db.query(`SELECT ${[
    selectColumn(organizerColumns, 'ora', ['id'], 'id'),
    selectColumn(organizerColumns, 'ora', ['email'], 'email'),
    selectColumn(organizerColumns, 'ora', ['organization_name', 'organizer_name', 'contact_name'], 'organization_name'),
    selectColumn(organizerColumns, 'ora', ['organizer_name'], 'organizer_name'),
    selectColumn(organizerColumns, 'ora', ['contact_name'], 'contact_name'),
    selectColumn(organizerColumns, 'ora', ['phone'], 'phone'),
    selectColumn(organizerColumns, 'ora', ['notes'], 'notes'),
    selectColumn(organizerColumns, 'ora', ['created_at'], 'created_at'),
    selectColumn(organizerColumns, 'ora', ['updated_at'], 'updated_at'),
  ].join(', ')} FROM organizer_role_accounts ora ORDER BY ora.created_at DESC LIMIT 50`)
  const [users] = await db.query('SELECT id, email, name, emailVerified, createdAt, updatedAt FROM `user` ORDER BY createdAt DESC LIMIT 50')
  const [appUsers] = await db.query(`SELECT ${[
    selectColumn(appUserColumns, 'au', ['id'], 'id'),
    selectColumn(appUserColumns, 'au', ['email'], 'email'),
    selectColumn(appUserColumns, 'au', ['display_name', 'name'], 'display_name'),
    selectColumn(appUserColumns, 'au', ['primary_state'], 'primary_state'),
    selectColumn(appUserColumns, 'au', ['primary_city'], 'primary_city'),
    selectColumn(appUserColumns, 'au', ['created_at'], 'created_at'),
    selectColumn(appUserColumns, 'au', ['updated_at'], 'updated_at'),
  ].join(', ')} FROM app_users au ORDER BY au.created_at DESC LIMIT 50`)
  const teamMemberEmailsSelect = teamMemberColumns.has('team_id') && teamMemberColumns.has('email')
    ? `(SELECT GROUP_CONCAT(DISTINCT NULLIF(tmm.email, '') ORDER BY tmm.email SEPARATOR ', ') FROM team_members tmm WHERE tmm.team_id = tm.id) AS team_member_emails`
    : 'NULL AS team_member_emails'
  const [teams] = await db.query(`SELECT ${[
    selectColumn(teamColumns, 'tm', ['id'], 'id'),
    selectColumn(teamColumns, 'tm', ['name'], 'name'),
    selectColumn(teamColumns, 'tm', ['created_by_email'], 'created_by_email'),
    teamMemberEmailsSelect,
    selectColumn(teamColumns, 'tm', ['created_at'], 'created_at'),
    selectColumn(teamColumns, 'tm', ['updated_at'], 'updated_at'),
  ].join(', ')} FROM teams tm ORDER BY tm.created_at DESC LIMIT 50`)
  const [scores] = await db.query(`SELECT ${[
    selectColumn(scoreColumns, 's', ['id'], 'id'),
    selectColumn(scoreColumns, 's', ['mode'], 'mode'),
    selectColumn(scoreColumns, 's', ['course'], 'course'),
    selectColumn(scoreColumns, 's', ['created_by_email'], 'created_by_email'),
    selectColumn(scoreColumns, 's', ['created_at'], 'created_at'),
    selectColumn(scoreColumns, 's', ['updated_at'], 'updated_at'),
  ].join(', ')} FROM scores s ORDER BY s.created_at DESC LIMIT 50`)
  const [tournamentStatusCounts] = await db.query("SELECT COALESCE(NULLIF(status, ''), 'unknown') AS status, COUNT(*) AS count FROM tournaments GROUP BY COALESCE(NULLIF(status, ''), 'unknown') ORDER BY count DESC, status ASC")

  const tournamentNameExpr = tournamentColumns.has('title')
    ? "COALESCE(NULLIF(t.name, ''), NULLIF(t.title, ''), CONCAT('Tournament ', t.id))"
    : "COALESCE(NULLIF(t.name, ''), CONCAT('Tournament ', t.id))"
  const creatorParts = [
    nullableColumnRef(tournamentColumns, 't', 'organizer_email'),
    nullableColumnRef(organizerColumns, 'ora', 'email'),
    nullableColumnRef(hostColumns, 'ha', 'email'),
    nullableColumnRef(hostRoleColumns, 'hra', 'email'),
    tournamentColumns.has('created_by_auth_user_id') ? 't.created_by_auth_user_id' : null,
  ].filter(Boolean)
  const golfCourseParts = [
    nullableColumnRef(hostRoleColumns, 'hra', 'golf_course_name'),
    nullableColumnRef(hostRoleColumns, 'hra', 'account_name'),
    nullableColumnRef(hostColumns, 'ha', 'account_name'),
    nullableColumnRef(hostColumns, 'ha', 'golf_course_name'),
    nullableColumnRef(hostColumns, 'ha', 'course_name'),
    nullableColumnRef(hostColumns, 'ha', 'name'),
  ].filter(Boolean)
  const createdBySelect = tournamentColumns.has('created_by_auth_user_id') ? 't.created_by_auth_user_id' : 'NULL AS created_by_auth_user_id'
  const [tournaments] = await db.query(`
    SELECT
      t.id,
      ${tournamentNameExpr} AS name,
      COALESCE(NULLIF(t.status, ''), 'unknown') AS status,
      t.created_at,
      t.updated_at,
      ${createdBySelect},
      COALESCE(${creatorParts.join(', ') || 'NULL'}) AS creator,
      COALESCE(${golfCourseParts.join(', ') || 'NULL'}) AS golf_course_name
    FROM tournaments t
    LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
    LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
    LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
    ORDER BY t.created_at DESC
    LIMIT 50
  `)

  const requestSelectColumns = [
    'id',
    'first_name',
    'last_name',
    'email',
    requestStateCodeColumn ? escapeIdentifier(requestStateCodeColumn) + ' AS state_code' : "'' AS state_code",
    requestStateNameColumn ? escapeIdentifier(requestStateNameColumn) + ' AS state_name' : "'' AS state_name",
    'golf_course_name',
    'representative_details',
    'status',
    requestReviewedByEmailColumn ? escapeIdentifier(requestReviewedByEmailColumn) + ' AS reviewed_by_email' : 'NULL AS reviewed_by_email',
    requestReviewedAtColumn ? escapeIdentifier(requestReviewedAtColumn) + ' AS reviewed_at' : 'NULL AS reviewed_at',
    requestApprovedHostAccountIdColumn ? escapeIdentifier(requestApprovedHostAccountIdColumn) + ' AS approved_host_account_id' : 'NULL AS approved_host_account_id',
    'created_at',
  ]
  const [requests] = await db.query(`SELECT ${requestSelectColumns.join(', ')} FROM host_account_requests ORDER BY created_at DESC LIMIT 50`)

  return {
    summary: { userCount, appUserCount, teamCount, scoreCount, hostCount, organizerCount, tournamentCount, hostAccountRequestCount },
    admins,
    hosts,
    organizers,
    tournaments,
    tournamentStatusCounts,
    users,
    appUsers,
    teams,
    scores,
    requests,
  }
}
