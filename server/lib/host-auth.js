import crypto from 'crypto'
import { sendMail } from '../mailer.js'
import { getPool } from '../db.js'

const HOST_SESSION_COOKIE = 'golfhomiez_host_session'
const HOST_RESET_TTL_MS = 1000 * 60 * 60
const HOST_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14

function getDb(source) {
  const candidates = [
    source?.app?.locals?.db,
    source?.app?.locals?.pool,
    source?.db,
    source?.pool,
    source,
    getPool(),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (typeof candidate.promise === 'function') {
      return candidate.promise()
    }

    if (candidate.pool && typeof candidate.pool.promise === 'function') {
      return candidate.pool.promise()
    }

    if (candidate.connection && typeof candidate.connection.promise === 'function') {
      return candidate.connection.promise()
    }

    if (
      typeof candidate.execute === 'function'
      && typeof candidate.query === 'function'
      && typeof candidate.getConnection !== 'function'
    ) {
      return candidate
    }
  }

  throw new Error('Promise-compatible database handle unavailable')
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    String(cookieHeader)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=')
        return idx >= 0 ? [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))] : [part, '']
      }),
  )
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
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(hash, 'hex'))
}

async function tableExists(db, tableName) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [tableName],
  )
  return rows.length > 0
}

async function getColumnRows(db, tableName) {
  const [rows] = await db.execute(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, DATA_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  )
  return rows
}

async function getColumns(db, tableName) {
  const rows = await getColumnRows(db, tableName)
  return new Set(rows.map((r) => r.COLUMN_NAME))
}

async function columnExists(db, tableName, columnName) {
  const rows = await getColumnRows(db, tableName)
  return rows.some((row) => row.COLUMN_NAME === columnName)
}

function pickFirstAvailable(columns, names) {
  return names.find((name) => columns.has(name)) || null
}

async function ensureColumn(db, tableName, definitionStart) {
  const col = definitionStart.trim().split(/\s+/)[0].replace(/`/g, '')
  if (await columnExists(db, tableName, col)) return
  await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionStart}`)
}

async function ensureIndex(db, tableName, indexName, ddl) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [tableName, indexName],
  )
  if (rows.length) return
  await db.query(ddl)
}

async function resolveNameColumns(db) {
  const columns = await getColumns(db, 'host_accounts')
  return ['golf_course_name', 'account_name', 'course_name', 'name'].filter((c) => columns.has(c))
}

async function resolvePrimaryNameColumn(db) {
  const cols = await resolveNameColumns(db)
  return cols[0] || null
}

export async function ensureHostAuthSchema(source) {
  const db = getDb(source)
  await db.query(`CREATE TABLE IF NOT EXISTS host_account_invites (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    email VARCHAR(191) NOT NULL,
    invitee_email VARCHAR(191) NULL,
    name VARCHAR(191) NULL,
    invitee_name VARCHAR(191) NULL,
    account_name VARCHAR(191) NULL,
    course_name VARCHAR(191) NULL,
    golf_course_name VARCHAR(191) NULL,
    security_key VARCHAR(255) NULL,
    security_key_hash VARCHAR(255) NULL,
    admin_user_id VARCHAR(64) NULL,
    invited_by_admin_id VARCHAR(64) NULL,
    consumed_at DATETIME NULL,
    revoked_at DATETIME NULL,
    expires_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

  await db.query(`CREATE TABLE IF NOT EXISTS host_accounts (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    email VARCHAR(191) NOT NULL,
    auth_user_id VARCHAR(191) NULL,
    golf_course_name VARCHAR(191) NULL,
    account_name VARCHAR(191) NULL,
    course_name VARCHAR(191) NULL,
    name VARCHAR(191) NULL,
    password_hash VARCHAR(255) NULL,
    invite_id VARCHAR(64) NULL,
    reset_email VARCHAR(191) NULL,
    is_validated TINYINT(1) NOT NULL DEFAULT 0,
    validated_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

  await db.query(`CREATE TABLE IF NOT EXISTS host_sessions (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    host_account_id VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_host_sessions_account (host_account_id),
    INDEX idx_host_sessions_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

  await db.query(`CREATE TABLE IF NOT EXISTS host_password_reset_tokens (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    host_account_id VARCHAR(64) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_host_reset_account (host_account_id),
    INDEX idx_host_reset_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

  if (await tableExists(db, 'host_accounts')) {
    await ensureColumn(db, 'host_accounts', 'auth_user_id VARCHAR(191) NULL')
    await ensureColumn(db, 'host_accounts', 'password_hash VARCHAR(255) NULL')
    await ensureColumn(db, 'host_accounts', 'invite_id VARCHAR(64) NULL')
    await ensureColumn(db, 'host_accounts', 'reset_email VARCHAR(191) NULL')
    await ensureColumn(db, 'host_accounts', 'is_validated TINYINT(1) NOT NULL DEFAULT 0')
    await ensureColumn(db, 'host_accounts', 'validated_at DATETIME NULL')
  }

  await ensureIndex(db, 'host_accounts', 'idx_host_accounts_email', 'CREATE INDEX idx_host_accounts_email ON host_accounts (email)')
  return true
}

async function findActiveInvite(db, email, securityKey) {
  const columns = await getColumns(db, 'host_account_invites')
  const emailCol = columns.has('invitee_email') ? 'invitee_email' : 'email'
  const keyCol = columns.has('security_key_hash') ? 'security_key_hash' : (columns.has('security_key') ? 'security_key' : null)
  const activeClauses = ['consumed_at IS NULL']
  if (columns.has('revoked_at')) activeClauses.push('revoked_at IS NULL')
  if (columns.has('expires_at')) activeClauses.push('(expires_at IS NULL OR expires_at > NOW())')
  const [rows] = await db.execute(
    `SELECT * FROM host_account_invites WHERE ${emailCol} = ? AND ${activeClauses.join(' AND ')} ORDER BY created_at DESC LIMIT 10`,
    [email],
  )
  const hashed = sha256(securityKey)
  return rows.find((row) => {
    if (!keyCol) return false
    const stored = row[keyCol]
    return stored === securityKey || stored === hashed
  }) || null
}


async function buildInsertParts(db, tableName, assignments) {
  const rows = await getColumnRows(db, tableName)
  const rowMap = new Map(rows.map((row) => [row.COLUMN_NAME, row]))
  const columns = []
  const values = []
  const params = []

  for (const [column, value] of assignments) {
    if (!rowMap.has(column) || value === undefined) continue
    columns.push(column)
    if (value === '__NOW__') {
      values.push('NOW()')
    } else {
      values.push('?')
      params.push(value)
    }
  }

  const missingRequired = rows
    .filter((row) => row.IS_NULLABLE === 'NO' && row.COLUMN_DEFAULT == null && !String(row.EXTRA || '').includes('auto_increment'))
    .map((row) => row.COLUMN_NAME)
    .filter((column) => !columns.includes(column))

  return { rows, rowMap, columns, values, params, missingRequired }
}

export async function redeemHostInvite(source, payload = {}) {
  const db = getDb(source)
  await ensureHostAuthSchema(db)
  const email = String(payload.email || '').trim().toLowerCase()
  const securityKey = String(payload.securityKey || payload.security_key || '').trim()
  const accountName = String(payload.golfCourseName || payload.accountName || payload.courseName || payload.name || '').trim()
  const password = String(payload.password || '')
  if (!email || !securityKey || !accountName || !password) throw new Error('Missing required host registration fields')

  const invite = await findActiveInvite(db, email, securityKey)
  if (!invite) throw new Error('Invalid invite email or security key')

  const accountColumns = await getColumns(db, 'host_accounts')
  const nameCols = ['golf_course_name', 'account_name', 'course_name', 'name'].filter((c) => accountColumns.has(c))
  const hostId = randomId(32)
  const authUserId = `host:${email}`
  const passwordHash = hashPassword(password)
  const insertCols = []
  const insertVals = []
  const insertParams = []

  insertCols.push('id'); insertVals.push('?'); insertParams.push(hostId)
  if (accountColumns.has('email')) { insertCols.push('email'); insertVals.push('?'); insertParams.push(email) }
  if (accountColumns.has('auth_user_id')) { insertCols.push('auth_user_id'); insertVals.push('?'); insertParams.push(authUserId) }
  if (accountColumns.has('password_hash')) { insertCols.push('password_hash'); insertVals.push('?'); insertParams.push(passwordHash) }
  if (accountColumns.has('invite_id')) { insertCols.push('invite_id'); insertVals.push('?'); insertParams.push(invite.id) }
  if (accountColumns.has('reset_email')) { insertCols.push('reset_email'); insertVals.push('?'); insertParams.push(email) }
  if (accountColumns.has('is_validated')) { insertCols.push('is_validated'); insertVals.push('?'); insertParams.push(1) }
  if (accountColumns.has('validated_at')) { insertCols.push('validated_at'); insertVals.push('NOW()') }
  for (const col of nameCols) {
    insertCols.push(col)
    insertVals.push('?')
    insertParams.push(accountName)
  }

  const updateAssignments = []
  if (accountColumns.has('password_hash')) updateAssignments.push('password_hash = VALUES(password_hash)')
  if (accountColumns.has('invite_id')) updateAssignments.push('invite_id = VALUES(invite_id)')
  if (accountColumns.has('reset_email')) updateAssignments.push('reset_email = VALUES(reset_email)')
  if (accountColumns.has('auth_user_id')) updateAssignments.push('auth_user_id = VALUES(auth_user_id)')
  if (accountColumns.has('is_validated')) updateAssignments.push('is_validated = 1')
  if (accountColumns.has('validated_at')) updateAssignments.push('validated_at = NOW()')
  for (const col of nameCols) updateAssignments.push(`${col} = VALUES(${col})`)
  if (accountColumns.has('updated_at')) updateAssignments.push('updated_at = CURRENT_TIMESTAMP')

  const hasEmailColumn = accountColumns.has('email')
  if (hasEmailColumn && updateAssignments.length) {
    await db.execute(
      `INSERT INTO host_accounts (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')}) ON DUPLICATE KEY UPDATE ${updateAssignments.join(', ')}`,
      insertParams,
    )
  } else {
    await db.execute(`INSERT INTO host_accounts (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})`, insertParams)
  }

  const inviteColumns = await getColumns(db, 'host_account_invites')
  const updates = []
  if (inviteColumns.has('consumed_at')) updates.push('consumed_at = NOW()')
  if (inviteColumns.has('updated_at')) updates.push('updated_at = CURRENT_TIMESTAMP')
  if (updates.length) await db.execute(`UPDATE host_account_invites SET ${updates.join(', ')} WHERE id = ?`, [invite.id])

  const hostAccount = await getHostAccountByEmail(db, email)
  const resolvedHostAccount = hostAccount || {
    id: hostId,
    email,
    auth_user_id: authUserId,
    invite_id: invite.id,
    reset_email: email,
    is_validated: 1,
    validated_at: new Date(),
    golf_course_name: accountName,
  }
  const session = await createHostSession(db, resolvedHostAccount.id || hostId)
  return { hostAccount: resolvedHostAccount, session }
}

export async function getHostAccountByEmail(source, email) {
  const db = getDb(source)
  await ensureHostAuthSchema(db)
  const nameCol = await resolvePrimaryNameColumn(db)
  const selectName = nameCol ? `${nameCol} AS golf_course_name,` : ''
  const [rows] = await db.execute(
    `SELECT id, email, auth_user_id, password_hash, invite_id, reset_email, is_validated, validated_at, ${selectName} created_at, updated_at FROM host_accounts WHERE email = ? LIMIT 1`,
    [email],
  )
  return rows[0] || null
}

export async function authenticateHostLogin(source, { email, password }) {
  const host = await getHostAccountByEmail(source, String(email || '').trim().toLowerCase())
  if (!host || !verifyPassword(password, host.password_hash)) return null
  return host
}

export async function createHostSession(source, hostAccountId) {
  const db = getDb(source)
  await ensureHostAuthSchema(db)
  const resolvedHostAccountId = typeof hostAccountId === 'object' && hostAccountId !== null
    ? (hostAccountId.id || hostAccountId.host_account_id || hostAccountId.hostId || hostAccountId.account_id || hostAccountId.accountId || '')
    : hostAccountId
  if (!resolvedHostAccountId) {
    throw new Error('Missing host account id for session creation')
  }

  const sessionId = randomId(48)
  const expiresAt = new Date(Date.now() + HOST_SESSION_TTL_MS)
  const sessionAssignments = [
    ['id', sessionId],
    ['host_account_id', resolvedHostAccountId],
    ['host_id', resolvedHostAccountId],
    ['account_id', resolvedHostAccountId],
    ['token_hash', sha256(sessionId)],
    ['token', sessionId],
    ['session_token', sessionId],
    ['session_id', sessionId],
    ['expires_at', expiresAt],
    ['created_at', '__NOW__'],
    ['updated_at', '__NOW__'],
  ]
  let { columns, values, params, missingRequired } = await buildInsertParts(db, 'host_sessions', sessionAssignments)

  if (missingRequired.length) {
    const sessionColumns = await getColumns(db, 'host_sessions')
    const fillMap = new Map([
      ['id', sessionId],
      ['host_account_id', resolvedHostAccountId],
      ['host_id', resolvedHostAccountId],
      ['account_id', resolvedHostAccountId],
      ['token_hash', sha256(sessionId)],
      ['token', sessionId],
      ['session_token', sessionId],
      ['session_id', sessionId],
      ['expires_at', expiresAt],
      ['created_at', '__NOW__'],
      ['updated_at', '__NOW__'],
    ])
    for (const column of missingRequired) {
      if (!sessionColumns.has(column) || !fillMap.has(column) || columns.includes(column)) continue
      columns.push(column)
      const value = fillMap.get(column)
      if (value === '__NOW__') {
        values.push('NOW()')
      } else {
        values.push('?')
        params.push(value)
      }
    }
    const rebuilt = await buildInsertParts(db, 'host_sessions', columns.map((column, idx) => [column, values[idx] === 'NOW()' ? '__NOW__' : params[[...values.slice(0, idx)].filter(v => v === '?').length-1]]))
    missingRequired = rebuilt.missingRequired
  }

  if (missingRequired.length) {
    throw new Error(`host_sessions missing values for required columns: ${missingRequired.join(', ')}`)
  }
  await db.execute(`INSERT INTO host_sessions (${columns.join(', ')}) VALUES (${values.join(', ')})`, params)
  return { id: sessionId, hostAccountId: resolvedHostAccountId, expiresAt }
}


export function serializeHostSessionCookie(sessionId) {
  const maxAge = Math.floor(HOST_SESSION_TTL_MS / 1000)
  return `${HOST_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

export function clearHostSessionCookie() {
  return `${HOST_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export async function destroyHostSession(source, sessionId) {
  const db = getDb(source)
  if (!sessionId) return
  const columns = await getColumns(db, 'host_sessions')
  const matchCol = columns.has('token_hash') ? 'token_hash' : pickFirstAvailable(columns, ['token', 'session_token', 'session_id']) || 'id'
  const matchValue = matchCol === 'token_hash' ? sha256(sessionId) : sessionId
  await db.execute(`DELETE FROM host_sessions WHERE ${matchCol} = ?`, [matchValue])
}


export async function getHostAccountBySession(source, sessionId) {
  const db = getDb(source)
  if (!sessionId) return null
  await ensureHostAuthSchema(db)
  const nameCol = await resolvePrimaryNameColumn(db)
  const selectName = nameCol ? `h.${nameCol} AS golf_course_name,` : ''
  const sessionColumns = await getColumns(db, 'host_sessions')
  const joinCol = pickFirstAvailable(sessionColumns, ['host_account_id', 'host_id', 'account_id']) || 'host_account_id'
  const matchCol = sessionColumns.has('token_hash') ? 'token_hash' : pickFirstAvailable(sessionColumns, ['token', 'session_token', 'session_id']) || 'id'
  const matchValue = matchCol === 'token_hash' ? sha256(sessionId) : sessionId
  const expiryClause = sessionColumns.has('expires_at') ? 'AND s.expires_at > NOW()' : ''
  const [rows] = await db.execute(
    `SELECT h.id, h.email, h.auth_user_id, h.invite_id, h.reset_email, h.is_validated, h.validated_at, ${selectName} h.created_at, h.updated_at
     FROM host_sessions s
     JOIN host_accounts h ON h.id = s.${joinCol}
     WHERE s.${matchCol} = ? ${expiryClause}
     LIMIT 1`,
    [matchValue],
  )
  return rows[0] || null
}


export async function hostAuthMiddleware(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || '')
    const sessionId = cookies[HOST_SESSION_COOKIE]
    const hostAccount = await getHostAccountBySession(req, sessionId)
    if (!hostAccount) return res.status(401).json({ error: 'Host authentication required' })
    req.hostAccount = hostAccount
    req.hostSessionId = sessionId
    return next()
  } catch (error) {
    return next(error)
  }
}

export async function createHostPasswordReset(source, identifier) {
  const db = getDb(source)
  const normalizedIdentifier = typeof identifier === 'string'
    ? String(identifier || '').trim().toLowerCase()
    : String(identifier?.email || identifier?.identifier || '').trim().toLowerCase()
  const resetUrlBase = typeof identifier === 'object' && identifier ? String(identifier.resetUrlBase || '').trim() : ''
  const host = await getHostAccountByEmail(db, normalizedIdentifier)
  if (!host) return { ok: true }
  const token = randomId(32)
  const tokenHash = sha256(token)
  const id = randomId(32)
  const expiresAt = new Date(Date.now() + HOST_RESET_TTL_MS)
  const resetAssignments = [
    ['id', id],
    ['host_account_id', host.id],
    ['host_id', host.id],
    ['account_id', host.id],
    ['token_hash', tokenHash],
    ['token', token],
    ['expires_at', expiresAt],
    ['created_at', '__NOW__'],
    ['updated_at', '__NOW__'],
  ]
  const { columns, values, params, missingRequired } = await buildInsertParts(db, 'host_password_reset_tokens', resetAssignments)
  if (missingRequired.length) {
    throw new Error(`host_password_reset_tokens missing values for required columns: ${missingRequired.join(', ')}`)
  }
  await db.execute(`INSERT INTO host_password_reset_tokens (${columns.join(', ')}) VALUES (${values.join(', ')})`, params)
  const appOrigin = resetUrlBase || process.env.APP_ORIGIN || process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5174'
  const resetUrl = `${appOrigin.replace(/\/$/, '')}/host/reset-password?token=${encodeURIComponent(token)}`
  await sendMail({
    to: host.reset_email || host.email,
    subject: 'Reset your GolfHomiez host password',
    text: `Reset your host password: ${resetUrl}`,
    html: `<p>Reset your host password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  })
  return { ok: true }
}


export async function resetHostPassword(source, { token, password }) {
  const db = getDb(source)
  const resetColumns = await getColumns(db, 'host_password_reset_tokens')
  const tokenCol = resetColumns.has('token_hash') ? 'token_hash' : (resetColumns.has('token') ? 'token' : 'token_hash')
  const tokenValue = tokenCol === 'token_hash' ? sha256(String(token || '').trim()) : String(token || '').trim()
  const usedClause = resetColumns.has('used_at') ? 'AND used_at IS NULL' : ''
  const expiresClause = resetColumns.has('expires_at') ? 'AND expires_at > NOW()' : ''
  const [rows] = await db.execute(
    `SELECT * FROM host_password_reset_tokens WHERE ${tokenCol} = ? ${usedClause} ${expiresClause} LIMIT 1`,
    [tokenValue],
  )
  const reset = rows[0]
  if (!reset) throw new Error('Invalid or expired reset token')
  await db.execute('UPDATE host_accounts SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hashPassword(password), reset.host_account_id || reset.host_id || reset.account_id])
  if (resetColumns.has('used_at')) {
    await db.execute('UPDATE host_password_reset_tokens SET used_at = NOW() WHERE id = ?', [reset.id])
  }
  return { ok: true }
}


export async function getHostPortalData(source, hostAccountId) {
  const db = getDb(source)
  const nameCol = await resolvePrimaryNameColumn(db)
  const selectName = nameCol ? `${nameCol} AS golf_course_name,` : ''
  const [accounts] = await db.execute(
    `SELECT id, email, ${selectName} is_validated, validated_at, created_at, updated_at FROM host_accounts WHERE id = ? LIMIT 1`,
    [hostAccountId],
  )
  return { host: accounts[0] || null }
}
