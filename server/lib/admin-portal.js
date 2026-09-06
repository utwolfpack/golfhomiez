import crypto from 'node:crypto'
import { getPool } from '../db.js'
import { sendMail } from '../mailer.js'
import { normalizeEmail, isEmail } from './team-utils.js'
import { ensureHostAuthSchema } from './host-auth.js'
import { createGolfCoursePublicPageForApprovedHost } from './golf-course-public-pages.js'
import { assertPasswordPolicy } from './password-policy.js'
import { listBillingAdminCustomers } from './billing.js'

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
  await addColumnIfMissing('host_account_requests', 'golf_course_id', 'VARCHAR(64) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'requested_password_hash', 'VARCHAR(255) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'reviewed_by_admin_id', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'reviewed_by_email', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'reviewed_at', 'DATETIME NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'approved_host_account_id', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'approval_route', "VARCHAR(32) NOT NULL DEFAULT 'golfhomiez_admin'", { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'routed_host_account_id', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'routed_host_email', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'reviewed_by_host_account_id', 'VARCHAR(191) NULL', { ignoreDuplicate: true })
  await addColumnIfMissing('host_account_requests', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', { ignoreDuplicate: true })

  if (!await indexExists('host_account_requests', 'idx_host_account_requests_status_created')) {
    await pool().query('CREATE INDEX idx_host_account_requests_status_created ON host_account_requests (status, created_at)')
  }
  if (!await indexExists('host_account_requests', 'idx_host_account_requests_email')) {
    await pool().query('CREATE INDEX idx_host_account_requests_email ON host_account_requests (email)')
  }
  if (!await indexExists('host_account_requests', 'idx_host_account_requests_route_status')) {
    await pool().query('CREATE INDEX idx_host_account_requests_route_status ON host_account_requests (approval_route, status, created_at)')
  }
  if (!await indexExists('host_account_requests', 'idx_host_account_requests_routed_host')) {
    await pool().query('CREATE INDEX idx_host_account_requests_routed_host ON host_account_requests (routed_host_account_id, status)')
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


async function findPrimaryHostAccountForCourse({ golfCourseId = null, golfCourseName = '' }) {
  await ensureHostAuthSchema(pool())
  const columns = await getTableColumns('host_accounts')
  const normalizedGolfCourseId = String(golfCourseId || '').trim()
  const normalizedGolfCourseName = String(golfCourseName || '').trim()
  const nameColumn = ['golf_course_name', 'account_name', 'course_name', 'name'].find((columnName) => columns.has(columnName)) || null
  const contactNameSelect = columns.has('contact_name') ? 'contact_name' : 'NULL AS contact_name'

  if (normalizedGolfCourseId && columns.has('golf_course_id')) {
    const [rows] = await pool().execute(
      `SELECT id, email, ${contactNameSelect}
         FROM host_accounts
        WHERE golf_course_id = ?
          AND is_validated = 1
          AND is_course_admin = 1
        ORDER BY validated_at ASC, created_at ASC, id ASC
        LIMIT 1`,
      [normalizedGolfCourseId],
    )
    if (rows[0]) return rows[0]
  }

  if (nameColumn && normalizedGolfCourseName) {
    const [rows] = await pool().execute(
      `SELECT id, email, ${contactNameSelect}
         FROM host_accounts
        WHERE LOWER(TRIM(COALESCE(${escapeIdentifier(nameColumn)}, ''))) = LOWER(?)
          AND is_validated = 1
          AND is_course_admin = 1
        ORDER BY validated_at ASC, created_at ASC, id ASC
        LIMIT 1`,
      [normalizedGolfCourseName],
    )
    if (rows[0]) return rows[0]
  }

  return null
}

function primaryHostDisplayName(host = {}) {
  return String(host.contact_name || '').trim() || String(host.email || '').trim() || 'the current golf-course account admin'
}

async function sendHostAccountRequestRoutedEmail({ email, firstName, golfCourseName, primaryHostName }) {
  const greetingName = String(firstName || '').trim() || 'there'
  const subject = `Your Golf Homiez golf-course account request for ${golfCourseName}`
  const text = [
    `Hello ${greetingName},`,
    '',
    `Your request to create a Golf Homiez account for ${golfCourseName} has been routed to the current primary golf-course account admin, ${primaryHostName}, for review.`,
    'The golf-course host team can approve or deny the request from its Golf Homiez host portal.',
    'You will receive another email after the request is reviewed.',
  ].join('\n')
  const html = `
    <p>Hello ${greetingName},</p>
    <p>Your request to create a Golf Homiez account for <strong>${golfCourseName}</strong> has been routed to the current primary golf-course account admin, <strong>${primaryHostName}</strong>, for review.</p>
    <p>The golf-course host team can approve or deny the request from its Golf Homiez host portal. You will receive another email after the request is reviewed.</p>
  `
  await sendMail({ to: email, subject, text, html })
}

async function sendPrimaryHostAccountRequestNotification({ primaryHost, firstName, lastName, email, golfCourseName, representativeDetails }) {
  const hostLoginUrl = buildHostLoginUrl()
  const primaryHostName = primaryHostDisplayName(primaryHost)
  const subject = `New Golf Homiez host account request for ${golfCourseName}`
  const text = [
    `Hello ${primaryHostName},`,
    '',
    `A new host account has been requested for ${golfCourseName}.`,
    `Requester: ${firstName} ${lastName}`.trim(),
    `Email: ${email}`,
    `Representative details: ${representativeDetails}`,
    '',
    'Sign in to the Golf Homiez host portal to approve or deny this request:',
    hostLoginUrl,
  ].join('\n')
  const html = `
    <p>Hello ${primaryHostName},</p>
    <p>A new host account has been requested for <strong>${golfCourseName}</strong>.</p>
    <p><strong>Requester:</strong> ${firstName} ${lastName}<br />
    <strong>Email:</strong> ${email}<br />
    <strong>Representative details:</strong> ${representativeDetails}</p>
    <p><a href="${hostLoginUrl}">Sign in to the Golf Homiez host portal</a> to approve or deny this request.</p>
  `
  await sendMail({ to: primaryHost.email, subject, text, html })
}

async function sendHostAccountDeniedEmail({ email, firstName, golfCourseName }) {
  const greetingName = String(firstName || '').trim() || 'there'
  const subject = `Golf Homiez golf-course account request for ${golfCourseName}`
  const text = [
    `Hello ${greetingName},`,
    '',
    `Your request for a Golf Homiez host account for ${golfCourseName} was not approved by the golf-course host team.`,
    'Contact the golf course directly if you believe the request should be reconsidered.',
  ].join('\n')
  const html = `
    <p>Hello ${greetingName},</p>
    <p>Your request for a Golf Homiez host account for <strong>${golfCourseName}</strong> was not approved by the golf-course host team.</p>
    <p>Contact the golf course directly if you believe the request should be reconsidered.</p>
  `
  await sendMail({ to: email, subject, text, html })
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

async function createOrUpdateApprovedHostAccount({ email, golfCourseName, golfCourseId = null, passwordHash = null, contactName = '' }) {
  await ensureHostAuthSchema(pool())
  const db = pool()
  const normalizedEmail = normalizeEmail(email)
  const normalizedGolfCourseName = String(golfCourseName || '').trim()
  const normalizedGolfCourseId = String(golfCourseId || '').trim() || null
  const normalizedContactName = String(contactName || '').replace(/\s+/g, ' ').trim()
  const [existingRows] = await db.execute('SELECT id FROM host_accounts WHERE email = ? LIMIT 1', [normalizedEmail])
  const existing = existingRows[0]
  const columns = await getTableColumns('host_accounts')
  const nameColumns = ['golf_course_name', 'account_name', 'course_name', 'name'].filter((columnName) => columns.has(columnName))
  let shouldBeCourseAdmin = false
  if (columns.has('is_course_admin')) {
    let existingCourseCount = 0
    if (normalizedGolfCourseId && columns.has('golf_course_id')) {
      const [[row = {}] = []] = await db.execute('SELECT COUNT(*) AS courseCount FROM host_accounts WHERE golf_course_id = ? AND is_validated = 1', [normalizedGolfCourseId])
      existingCourseCount = Number(row.courseCount || 0)
    } else if (nameColumns.length && normalizedGolfCourseName) {
      const [[row = {}] = []] = await db.execute(`SELECT COUNT(*) AS courseCount FROM host_accounts WHERE LOWER(TRIM(COALESCE(${escapeIdentifier(nameColumns[0])}, ''))) = LOWER(?) AND is_validated = 1`, [normalizedGolfCourseName])
      existingCourseCount = Number(row.courseCount || 0)
    }
    shouldBeCourseAdmin = existingCourseCount === 0
  }

  if (existing?.id) {
    const assignments = []
    const params = []
    if (columns.has('auth_user_id')) {
      assignments.push('auth_user_id = ?')
      params.push(`host:${normalizedEmail}`)
    }
    if (columns.has('golf_course_id')) {
      assignments.push('golf_course_id = ?')
      params.push(normalizedGolfCourseId)
    }
    if (columns.has('reset_email')) {
      assignments.push('reset_email = ?')
      params.push(normalizedEmail)
    }
    if (columns.has('password_hash') && passwordHash) {
      assignments.push('password_hash = ?')
      params.push(passwordHash)
    }
    if (columns.has('contact_name') && normalizedContactName) {
      assignments.push('contact_name = ?')
      params.push(normalizedContactName)
    }
    if (columns.has('is_validated')) assignments.push('is_validated = 1')
    if (columns.has('is_course_admin') && shouldBeCourseAdmin) assignments.push('is_course_admin = 1')
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
  if (columns.has('golf_course_id')) {
    insertColumns.push('golf_course_id')
    insertValues.push('?')
    insertParams.push(normalizedGolfCourseId)
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
  if (columns.has('contact_name') && normalizedContactName) {
    insertColumns.push('contact_name')
    insertValues.push('?')
    insertParams.push(normalizedContactName)
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
  if (columns.has('is_course_admin')) {
    insertColumns.push('is_course_admin')
    insertValues.push(shouldBeCourseAdmin ? '1' : '0')
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
    golf_course_id VARCHAR(64) NULL,
    representative_details TEXT NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'pending',
    approval_route VARCHAR(32) NOT NULL DEFAULT 'golfhomiez_admin',
    routed_host_account_id VARCHAR(191) NULL,
    routed_host_email VARCHAR(191) NULL,
    reviewed_by_admin_id VARCHAR(191) NULL,
    reviewed_by_host_account_id VARCHAR(191) NULL,
    reviewed_by_email VARCHAR(191) NULL,
    reviewed_at DATETIME NULL,
    approved_host_account_id VARCHAR(191) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_host_account_requests_status_created (status, created_at),
    INDEX idx_host_account_requests_email (email),
    INDEX idx_host_account_requests_route_status (approval_route, status, created_at),
    INDEX idx_host_account_requests_routed_host (routed_host_account_id, status)
  )
`)
  await ensureHostAccountRequestTableCompatibility()

  await db.query(`
    CREATE TABLE IF NOT EXISTS host_accounts (
      id VARCHAR(191) PRIMARY KEY,
      auth_user_id VARCHAR(191) NOT NULL UNIQUE,
      golf_course_id VARCHAR(64) NULL,
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
  assertPasswordPolicy(password)
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
  assertPasswordPolicy(nextPassword)
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

export async function createHostAccountRequest({ firstName, lastName, email, stateCode, stateName, golfCourseId = '', golfCourseName, representativeDetails, password }) {
  await ensureAdminPortalSchema()
  const normalizedEmail = normalizeEmail(email)
  if (!isEmail(normalizedEmail)) throw new Error('A valid email address is required.')
  const normalizedFirstName = String(firstName || '').trim()
  const normalizedLastName = String(lastName || '').trim()
  const normalizedStateCode = String(stateCode || '').trim().toUpperCase()
  const normalizedStateName = String(stateName || '').trim()
  const normalizedGolfCourseName = String(golfCourseName || '').trim()
  const normalizedGolfCourseId = String(golfCourseId || '').trim() || null
  const normalizedRepresentativeDetails = String(representativeDetails || '').trim()
  const normalizedPassword = String(password || '')

  if (!normalizedFirstName) throw new Error('First name is required.')
  if (!normalizedLastName) throw new Error('Last name is required.')
  if (!normalizedStateCode) throw new Error('State is required.')
  if (!normalizedStateName) throw new Error('State is required.')
  if (!normalizedGolfCourseName) throw new Error('Golf course is required.')
  if (!normalizedRepresentativeDetails) throw new Error('Representative details are required.')
  assertPasswordPolicy(normalizedPassword)

  const primaryHost = await findPrimaryHostAccountForCourse({ golfCourseId: normalizedGolfCourseId, golfCourseName: normalizedGolfCourseName })
  const approvalRoute = primaryHost ? 'course_primary_host' : 'golfhomiez_admin'
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
  if (requestColumns.has('golf_course_id')) insertMap.set('golf_course_id', normalizedGolfCourseId)
  if (requestColumns.has('representative_details')) insertMap.set('representative_details', normalizedRepresentativeDetails)
  if (requestColumns.has('requested_password_hash')) insertMap.set('requested_password_hash', hashHostAccountPassword(normalizedPassword))
  if (requestColumns.has('status')) insertMap.set('status', 'pending')
  if (requestColumns.has('approval_route')) insertMap.set('approval_route', approvalRoute)
  if (requestColumns.has('routed_host_account_id')) insertMap.set('routed_host_account_id', primaryHost?.id || null)
  if (requestColumns.has('routed_host_email')) insertMap.set('routed_host_email', primaryHost?.email || null)

  const insertColumns = [...insertMap.keys()]
  const placeholders = insertColumns.map(() => '?')
  await pool().execute(
    `INSERT INTO host_account_requests (${insertColumns.map((columnName) => escapeIdentifier(columnName)).join(', ')}) VALUES (${placeholders.join(', ')})`,
    [...insertMap.values()],
  )

  if (primaryHost) {
    const primaryHostName = primaryHostDisplayName(primaryHost)
    await sendHostAccountRequestRoutedEmail({
      email: normalizedEmail,
      firstName: normalizedFirstName,
      golfCourseName: normalizedGolfCourseName,
      primaryHostName,
    })
    await sendPrimaryHostAccountRequestNotification({
      primaryHost,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      email: normalizedEmail,
      golfCourseName: normalizedGolfCourseName,
      representativeDetails: normalizedRepresentativeDetails,
    })
  } else {
    await sendHostAccountRequestNotification({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      email: normalizedEmail,
      stateName: normalizedStateName,
      golfCourseName: normalizedGolfCourseName,
      golfCourseId: normalizedGolfCourseId,
      representativeDetails: normalizedRepresentativeDetails,
    })
  }

  return {
    id,
    status: 'pending',
    approvalRoute,
    routedHostAccountId: primaryHost?.id || null,
    routedHostEmail: primaryHost?.email || null,
    primaryHostName: primaryHost ? primaryHostDisplayName(primaryHost) : null,
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    email: normalizedEmail,
    stateCode: normalizedStateCode,
    stateName: normalizedStateName,
    golfCourseName: normalizedGolfCourseName,
    golfCourseId: normalizedGolfCourseId,
    representativeDetails: normalizedRepresentativeDetails,
  }
}


export async function listHostAccountRequestsForHost({ hostAccountId }) {
  await ensureAdminPortalSchema()
  await ensureHostAuthSchema(pool())
  const hostColumns = await getTableColumns('host_accounts')
  const nameColumn = ['golf_course_name', 'account_name', 'course_name', 'name'].find((columnName) => hostColumns.has(columnName)) || null
  const selectName = nameColumn ? `${escapeIdentifier(nameColumn)} AS golf_course_name` : `NULL AS golf_course_name`
  const [hostRows] = await pool().execute(
    `SELECT id, email, golf_course_id, is_validated, ${selectName}
       FROM host_accounts
      WHERE id = ?
      LIMIT 1`,
    [hostAccountId],
  )
  const host = hostRows[0]
  if (!host || !host.is_validated) throw new Error('Host account is not available.')

  const params = []
  let coursePredicate = '1 = 0'
  if (String(host.golf_course_id || '').trim()) {
    coursePredicate = 'golf_course_id = ?'
    params.push(String(host.golf_course_id).trim())
  } else if (String(host.golf_course_name || '').trim()) {
    coursePredicate = 'LOWER(TRIM(COALESCE(golf_course_name, \'\'))) = LOWER(?)'
    params.push(String(host.golf_course_name).trim())
  }
  const [rows] = await pool().execute(
    `SELECT id, first_name, last_name, email, state_code, state_name, golf_course_id, golf_course_name,
            representative_details, status, approval_route, routed_host_account_id, routed_host_email,
            reviewed_by_host_account_id, reviewed_by_email, reviewed_at, approved_host_account_id, created_at, updated_at
       FROM host_account_requests
      WHERE approval_route = 'course_primary_host'
        AND status = 'pending'
        AND ${coursePredicate}
      ORDER BY created_at ASC`,
    params,
  )
  return rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    stateCode: row.state_code,
    stateName: row.state_name,
    golfCourseId: row.golf_course_id,
    golfCourseName: row.golf_course_name,
    representativeDetails: row.representative_details,
    status: row.status,
    approvalRoute: row.approval_route,
    routedHostAccountId: row.routed_host_account_id,
    routedHostEmail: row.routed_host_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function reviewHostAccountRequestByHost({ requestId, hostAccountId, decision }) {
  await ensureAdminPortalSchema()
  const normalizedDecision = String(decision || '').trim().toLowerCase()
  if (!['approve', 'deny'].includes(normalizedDecision)) throw new Error('Decision must be approve or deny.')

  const pendingRequests = await listHostAccountRequestsForHost({ hostAccountId })
  const requestSummary = pendingRequests.find((item) => item.id === requestId)
  if (!requestSummary) throw new Error('Pending golf-course account request was not found for this host account.')

  const [requestRows] = await pool().execute('SELECT * FROM host_account_requests WHERE id = ? LIMIT 1', [requestId])
  const request = requestRows[0]
  if (!request || String(request.status || '').toLowerCase() !== 'pending') throw new Error('Golf-course account request has already been reviewed.')

  const [hostRows] = await pool().execute('SELECT id, email FROM host_accounts WHERE id = ? AND is_validated = 1 LIMIT 1', [hostAccountId])
  const actingHost = hostRows[0]
  if (!actingHost) throw new Error('Host account is not available.')

  let hostAccountIdCreated = null
  let publicPage = null
  if (normalizedDecision === 'approve') {
    hostAccountIdCreated = await createOrUpdateApprovedHostAccount({
      email: request.email,
      golfCourseName: request.golf_course_name,
      golfCourseId: request.golf_course_id || null,
      passwordHash: request.requested_password_hash || null,
      contactName: `${request.first_name || ''} ${request.last_name || ''}`.trim(),
    })
    publicPage = await createGolfCoursePublicPageForApprovedHost(pool(), {
      hostAccountId: hostAccountIdCreated,
      golfCourseId: request.golf_course_id || null,
      golfCourseName: request.golf_course_name,
      stateCode: request.state_code,
      baseUrl: getAppBaseUrl(),
    })
  }

  await pool().execute(
    `UPDATE host_account_requests
        SET status = ?,
            reviewed_by_host_account_id = ?,
            reviewed_by_email = ?,
            reviewed_at = UTC_TIMESTAMP(),
            approved_host_account_id = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [normalizedDecision === 'approve' ? 'approved' : 'denied', actingHost.id, actingHost.email, hostAccountIdCreated, requestId],
  )

  if (normalizedDecision === 'approve') {
    await sendHostAccountApprovalEmail({ email: request.email, firstName: request.first_name, golfCourseName: request.golf_course_name })
  } else {
    await sendHostAccountDeniedEmail({ email: request.email, firstName: request.first_name, golfCourseName: request.golf_course_name })
  }

  const [updatedRows] = await pool().execute('SELECT * FROM host_account_requests WHERE id = ? LIMIT 1', [requestId])
  return {
    request: updatedRows[0] || null,
    decision: normalizedDecision,
    approved: normalizedDecision === 'approve',
    denied: normalizedDecision === 'deny',
    hostAccountId: hostAccountIdCreated,
    publicPage,
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
  if (String(request.approval_route || 'golfhomiez_admin').toLowerCase() === 'course_primary_host') {
    throw new Error('Golf-course account request is routed to the current course host for approval.')
  }

  const hostAccountId = await createOrUpdateApprovedHostAccount({
    email: request.email,
    golfCourseName: request.golf_course_name,
    golfCourseId: request.golf_course_id || null,
    passwordHash: request.requested_password_hash || null,
    contactName: `${request.first_name || ''} ${request.last_name || ''}`.trim(),
  })

  const publicPage = await createGolfCoursePublicPageForApprovedHost(pool(), {
    hostAccountId,
    golfCourseId: request.golf_course_id || null,
    golfCourseName: request.golf_course_name,
    stateCode: request.state_code,
    baseUrl: getAppBaseUrl(),
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
    publicPage,
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
  const [[{ hostAccountRequestCount = 0 } = {}]] = await db.query("SELECT COUNT(*) AS hostAccountRequestCount FROM host_account_requests WHERE status = 'pending' AND COALESCE(approval_route, 'golfhomiez_admin') = 'golfhomiez_admin'")
  const billingCustomers = await listBillingAdminCustomers(db)
  const homieTokenUsers = billingCustomers.filter((customer) => customer.accessSource === 'code_free')
  const paidHomies = billingCustomers.filter((customer) => customer.accessSource === 'stripe' && ['active', 'trialing', 'past_due'].includes(String(customer.subscriptionStatus || '')))

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
  const inboxMessageColumns = await getTableColumns('inbox_messages')

  const requestStateCodeColumn = requestColumns.has('state_code') ? 'state_code' : null
  const requestStateNameColumn = requestColumns.has('state_name') ? 'state_name' : null
  const requestReviewedByEmailColumn = requestColumns.has('reviewed_by_email') ? 'reviewed_by_email' : null
  const requestReviewedAtColumn = requestColumns.has('reviewed_at') ? 'reviewed_at' : null
  const requestApprovedHostAccountIdColumn = requestColumns.has('approved_host_account_id') ? 'approved_host_account_id' : null

  const admins = await listAdminUsers()
  const adminCount = admins.length
  const activeAdminCount = admins.filter((admin) => Number(admin.is_active ?? 1) === 1).length

  let validatedHostCount = 0
  if (hostColumns.has('is_validated')) {
    const [[row = {}] = []] = await db.query('SELECT COUNT(*) AS validatedHostCount FROM host_accounts WHERE is_validated = 1')
    validatedHostCount = Number(row.validatedHostCount || 0)
  } else {
    validatedHostCount = Number(hostCount || 0)
  }

  let tournamentHostCount = 0
  if (tournamentColumns.has('host_account_id')) {
    const [[row = {}] = []] = await db.query("SELECT COUNT(DISTINCT NULLIF(host_account_id, '')) AS tournamentHostCount FROM tournaments")
    tournamentHostCount = Number(row.tournamentHostCount || 0)
  }

  let tournamentRegistrationCount = 0
  let tournamentsWithRegistrationsCount = 0
  if (await tableExists('tournament_registrations')) {
    const registrationColumns = await getTableColumns('tournament_registrations')
    const registrationTournamentMetric = registrationColumns.has('tournament_id') ? ', COUNT(DISTINCT tournament_id) AS tournamentsWithRegistrationsCount' : ''
    const [[row = {}] = []] = await db.query(`SELECT COUNT(*) AS tournamentRegistrationCount${registrationTournamentMetric} FROM tournament_registrations`)
    tournamentRegistrationCount = Number(row.tournamentRegistrationCount || 0)
    tournamentsWithRegistrationsCount = Number(row.tournamentsWithRegistrationsCount || 0)
  }

  let scoredTournamentTeamCount = 0
  if (await tableExists('tournament_team_scores')) {
    const teamScoreColumns = await getTableColumns('tournament_team_scores')
    const scorePredicate = teamScoreColumns.has('total_score') ? ' WHERE total_score IS NOT NULL' : ''
    const [[row = {}] = []] = await db.query(`SELECT COUNT(*) AS scoredTournamentTeamCount FROM tournament_team_scores${scorePredicate}`)
    scoredTournamentTeamCount = Number(row.scoredTournamentTeamCount || 0)
  }

  let challengeCount = 0
  let activeChallengeCount = 0
  let completedChallengeCount = 0
  let challenges = []
  let challengeStatusCounts = []
  if (inboxMessageColumns.has('message_type')) {
    const challengeKey = inboxMessageColumns.has('thread_id') ? "COALESCE(NULLIF(thread_id, ''), id)" : 'id'
    const challengeStatus = inboxMessageColumns.has('challenge_status') ? "LOWER(COALESCE(NULLIF(challenge_status, ''), 'active'))" : "'active'"
    const [[row = {}] = []] = await db.query(`
      SELECT
        COUNT(DISTINCT ${challengeKey}) AS challengeCount,
        COUNT(DISTINCT CASE WHEN ${challengeStatus} = 'completed' THEN ${challengeKey} END) AS completedChallengeCount,
        COUNT(DISTINCT CASE WHEN ${challengeStatus} <> 'completed' THEN ${challengeKey} END) AS activeChallengeCount
      FROM inbox_messages
      WHERE message_type IN ('challenge_request', 'individual_challenge')
    `)
    challengeCount = Number(row.challengeCount || 0)
    activeChallengeCount = Number(row.activeChallengeCount || 0)
    completedChallengeCount = Number(row.completedChallengeCount || 0)

    if (inboxMessageColumns.has('challenge_status')) {
      const [statusRows] = await db.query(`
        SELECT COALESCE(NULLIF(challenge_status, ''), 'active') AS status, COUNT(DISTINCT ${challengeKey}) AS count
        FROM inbox_messages
        WHERE message_type IN ('challenge_request', 'individual_challenge')
        GROUP BY COALESCE(NULLIF(challenge_status, ''), 'active')
        ORDER BY count DESC, status ASC
      `)
      challengeStatusCounts = statusRows
    } else if (challengeCount) {
      challengeStatusCounts = [{ status: 'active', count: challengeCount }]
    }

    const challengeOrderColumn = inboxMessageColumns.has('created_at') ? 'created_at' : 'id'
    const challengeSelect = [
      selectColumn(inboxMessageColumns, 'im', ['id'], 'id'),
      selectColumn(inboxMessageColumns, 'im', ['thread_id', 'id'], 'thread_id'),
      selectColumn(inboxMessageColumns, 'im', ['message_type'], 'message_type'),
      selectColumn(inboxMessageColumns, 'im', ['challenge_status'], 'challenge_status', "'active'"),
      selectColumn(inboxMessageColumns, 'im', ['proposer_team_name'], 'proposer_team_name'),
      selectColumn(inboxMessageColumns, 'im', ['challenged_team_name'], 'challenged_team_name'),
      selectColumn(inboxMessageColumns, 'im', ['challenge_date'], 'challenge_date'),
      selectColumn(inboxMessageColumns, 'im', ['challenge_course'], 'challenge_course'),
      selectColumn(inboxMessageColumns, 'im', ['sender_email'], 'sender_email'),
      selectColumn(inboxMessageColumns, 'im', ['created_at'], 'created_at'),
    ]
    const [challengeRows] = await db.query(`SELECT ${challengeSelect.join(', ')} FROM inbox_messages im WHERE im.message_type IN ('challenge_request', 'individual_challenge') ORDER BY im.${escapeIdentifier(challengeOrderColumn)} DESC LIMIT 50`)
    challenges = challengeRows
  }

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
      COALESCE(${golfCourseParts.join(', ') || 'NULL'}) AS golf_course_name,
      (SELECT COUNT(DISTINCT COALESCE(NULLIF(tr.auth_user_id, ''), NULLIF(LOWER(tr.email), '')))
         FROM tournament_registrations tr
        WHERE tr.tournament_id = t.id AND tr.status = 'registered') AS generated_user_count
    FROM tournaments t
    LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
    LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
    LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
    ORDER BY t.created_at DESC
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
    requestColumns.has('approval_route') ? 'approval_route' : "'golfhomiez_admin' AS approval_route",
    requestColumns.has('routed_host_account_id') ? 'routed_host_account_id' : 'NULL AS routed_host_account_id',
    requestColumns.has('routed_host_email') ? 'routed_host_email' : 'NULL AS routed_host_email',
    requestReviewedByEmailColumn ? escapeIdentifier(requestReviewedByEmailColumn) + ' AS reviewed_by_email' : 'NULL AS reviewed_by_email',
    requestReviewedAtColumn ? escapeIdentifier(requestReviewedAtColumn) + ' AS reviewed_at' : 'NULL AS reviewed_at',
    requestApprovedHostAccountIdColumn ? escapeIdentifier(requestApprovedHostAccountIdColumn) + ' AS approved_host_account_id' : 'NULL AS approved_host_account_id',
    'created_at',
  ]
  const [requests] = await db.query(`SELECT ${requestSelectColumns.join(', ')} FROM host_account_requests ORDER BY created_at DESC LIMIT 50`)

  return {
    summary: {
      userCount,
      appUserCount,
      teamCount,
      scoreCount,
      hostCount,
      validatedHostCount,
      organizerCount,
      tournamentCount,
      tournamentHostCount,
      tournamentRegistrationCount,
      tournamentsWithRegistrationsCount,
      scoredTournamentTeamCount,
      challengeCount,
      activeChallengeCount,
      completedChallengeCount,
      hostAccountRequestCount,
      adminCount,
      activeAdminCount,
      homieTokenUserCount: homieTokenUsers.length,
      paidHomieCount: paidHomies.length,
      tournamentsCompletedCount: Number(tournamentStatusCounts.find((row) => String(row.status).toLowerCase() === 'completed')?.count || 0),
      tournamentsCreatedCount: Number(tournamentCount || 0),
    },
    admins,
    hosts,
    organizers,
    tournaments,
    tournamentStatusCounts,
    challenges,
    challengeStatusCounts,
    users,
    appUsers,
    teams,
    scores,
    requests,
    homieTokenUsers,
    paidHomies,
  }
}
