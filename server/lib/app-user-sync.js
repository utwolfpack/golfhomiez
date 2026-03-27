import { getPool } from '../db.js'

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.execute('SHOW TABLES LIKE ?', [tableName])
  return rows.length > 0
}

async function getTableColumns(conn, tableName) {
  const [rows] = await conn.execute(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  )
  return new Set(rows.map((row) => row.COLUMN_NAME))
}

async function ensureUsersTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(191) PRIMARY KEY,
      email VARCHAR(191) NOT NULL,
      name VARCHAR(191) NULL,
      auth_user_id VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_auth_user_id (auth_user_id)
    )
  `)

  const columns = await getTableColumns(conn, 'users')
  if (!columns.has('name')) {
    await conn.query('ALTER TABLE users ADD COLUMN name VARCHAR(191) NULL AFTER email')
  }
  if (!columns.has('auth_user_id')) {
    await conn.query('ALTER TABLE users ADD COLUMN auth_user_id VARCHAR(191) NULL AFTER name')
  }
  if (!columns.has('created_at')) {
    await conn.query('ALTER TABLE users ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP')
  }
  if (!columns.has('updated_at')) {
    await conn.query('ALTER TABLE users ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
  }

  const [indexes] = await conn.execute(`SHOW INDEX FROM users`)
  const indexNames = new Set(indexes.map((row) => row.Key_name))
  if (!indexNames.has('uq_users_email')) {
    await conn.query('ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)')
  }
  if (!indexNames.has('uq_users_auth_user_id')) {
    await conn.query('ALTER TABLE users ADD UNIQUE KEY uq_users_auth_user_id (auth_user_id)')
  }
}

async function ensureScoresUserForeignKey(conn) {
  if (!(await tableExists(conn, 'scores'))) return

  const [constraints] = await conn.execute(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'scores'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND CONSTRAINT_NAME = 'fk_scores_user'`
  )

  if (constraints.length === 0) {
    await conn.query(`
      ALTER TABLE scores
      ADD CONSTRAINT fk_scores_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON DELETE RESTRICT
    `)
  }
}

async function getBetterAuthUserTable(conn) {
  if (await tableExists(conn, 'user')) return 'user'
  if (await tableExists(conn, 'users')) return 'users'
  return null
}

function pickName(record) {
  if (!record) return null
  return record.name || record.username || record.displayUsername || null
}

async function findAppUserById(conn, id) {
  const [rows] = await conn.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [String(id || '')])
  return rows[0] || null
}

async function findAppUserByAuthId(conn, authId) {
  const [rows] = await conn.execute('SELECT * FROM users WHERE auth_user_id = ? LIMIT 1', [String(authId || '')])
  return rows[0] || null
}

async function findAppUserByEmail(conn, email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const [rows] = await conn.execute('SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1', [normalized])
  return rows[0] || null
}

async function findAuthUser(conn, { authId, email }) {
  const userTable = await getBetterAuthUserTable(conn)
  if (!userTable) return null

  if (authId) {
    const [rows] = await conn.execute(`SELECT * FROM \`${userTable}\` WHERE id = ? LIMIT 1`, [String(authId)])
    if (rows[0]) return rows[0]
  }

  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const [rows] = await conn.execute(`SELECT * FROM \`${userTable}\` WHERE LOWER(email) = ? LIMIT 1`, [normalized])
  return rows[0] || null
}

export async function ensureAppUserRecord({ authId, email, name }, options = {}) {
  const db = getPool()
  const ownsConnection = !options.conn
  const conn = options.conn || await db.getConnection()

  try {
    await ensureUsersTable(conn)

    const normalizedEmail = normalizeEmail(email)
    const normalizedAuthId = String(authId || '').trim()
    const effectiveName = String(name || '').trim() || null

    let appUser = null
    if (normalizedAuthId) appUser = await findAppUserByAuthId(conn, normalizedAuthId)
    if (!appUser && normalizedAuthId) appUser = await findAppUserById(conn, normalizedAuthId)
    if (!appUser && normalizedEmail) appUser = await findAppUserByEmail(conn, normalizedEmail)

    if (appUser) {
      await conn.execute(
        `UPDATE users
            SET email = ?,
                name = ?,
                auth_user_id = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [normalizedEmail || appUser.email, effectiveName ?? appUser.name ?? null, normalizedAuthId || appUser.auth_user_id || null, appUser.id]
      )
      return {
        ...appUser,
        email: normalizedEmail || appUser.email,
        name: effectiveName ?? appUser.name ?? null,
        auth_user_id: normalizedAuthId || appUser.auth_user_id || null,
      }
    }

    const authUser = await findAuthUser(conn, { authId: normalizedAuthId, email: normalizedEmail })
    const recordId = normalizedAuthId || String(authUser?.id || '').trim() || normalizedEmail
    const recordEmail = normalizedEmail || normalizeEmail(authUser?.email)
    const recordName = effectiveName ?? pickName(authUser)

    if (!recordId || !recordEmail) {
      throw new Error('Cannot ensure app user record without an auth id or email')
    }

    await conn.execute(
      `INSERT INTO users (id, email, name, auth_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [recordId, recordEmail, recordName, normalizedAuthId || recordId]
    )

    return {
      id: recordId,
      email: recordEmail,
      name: recordName,
      auth_user_id: normalizedAuthId || recordId,
    }
  } finally {
    if (ownsConnection) conn.release()
  }
}

export async function backfillAppUsers(options = {}) {
  const db = getPool()
  const ownsConnection = !options.conn
  const conn = options.conn || await db.getConnection()

  try {
    await ensureUsersTable(conn)

    const userTable = await getBetterAuthUserTable(conn)
    if (!userTable) {
      return { synced: 0, inserted: 0, updated: 0, sourceTable: null }
    }

    const [authUsers] = await conn.query(`SELECT id, email, name, username, displayUsername FROM \`${userTable}\``)
    let inserted = 0
    let updated = 0

    for (const authUser of authUsers) {
      const before =
        (await findAppUserByAuthId(conn, authUser.id)) ||
        (await findAppUserById(conn, authUser.id)) ||
        (await findAppUserByEmail(conn, authUser.email))

      await ensureAppUserRecord({
        authId: authUser.id,
        email: authUser.email,
        name: pickName(authUser),
      }, { conn })

      if (before) updated += 1
      else inserted += 1
    }

    const [orphanedScoreUsers] = await conn.query(`
      SELECT DISTINCT s.created_by_user_id AS auth_id, s.created_by_email AS email
        FROM scores s
        LEFT JOIN users u ON u.id = s.created_by_user_id
       WHERE u.id IS NULL
    `)

    for (const orphan of orphanedScoreUsers) {
      const appUser = await ensureAppUserRecord({
        authId: orphan.auth_id,
        email: orphan.email,
        name: null,
      }, { conn })

      await conn.execute(
        `UPDATE scores
            SET created_by_user_id = ?,
                created_by_email = ?
          WHERE created_by_user_id = ?`,
        [appUser.id, appUser.email, orphan.auth_id]
      )
    }

    await ensureScoresUserForeignKey(conn)
    return {
      synced: authUsers.length,
      inserted,
      updated,
      sourceTable: userTable,
      repairedScores: orphanedScoreUsers.length,
    }
  } finally {
    if (ownsConnection) conn.release()
  }
}

export async function ensureAppUserSchemaAndBackfill(options = {}) {
  const db = getPool()
  const ownsConnection = !options.conn
  const conn = options.conn || await db.getConnection()

  try {
    await ensureUsersTable(conn)
    const result = await backfillAppUsers({ conn })
    return result
  } finally {
    if (ownsConnection) conn.release()
  }
}
