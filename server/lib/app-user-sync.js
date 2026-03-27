import { logError, logInfo, logWarn } from '../lib/logger.js'

function getDatabaseName(connection) {
  return process.env.DB_NAME || process.env.MYSQL_DATABASE || connection.config?.database || 'golf_homiez'
}

export async function tableExists(connection, tableName) {
  const databaseName = getDatabaseName(connection)
  const [rows] = await connection.execute(
    `SELECT 1
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
      LIMIT 1`,
    [databaseName, tableName],
  )

  return rows.length > 0
}

export async function columnExists(connection, tableName, columnName) {
  const databaseName = getDatabaseName(connection)
  const [rows] = await connection.execute(
    `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [databaseName, tableName, columnName],
  )

  return rows.length > 0
}

export async function getBetterAuthUserTable(connection) {
  const candidates = ['user', 'users']

  for (const tableName of candidates) {
    if (await tableExists(connection, tableName)) {
      return tableName
    }
  }

  return null
}

async function ensureAppUsersTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id VARCHAR(191) PRIMARY KEY,
      auth_user_id VARCHAR(191) NOT NULL UNIQUE,
      email VARCHAR(191) NOT NULL,
      name VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_app_users_email (email)
    )
  `)
}

export async function backfillAppUsers(connection) {
  const authUserTable = await getBetterAuthUserTable(connection)

  if (!authUserTable) {
    logWarn('Skipped app_users backfill because no Better Auth user table was found')
    return { inserted: 0, sourceTable: null }
  }

  const hasId = await columnExists(connection, authUserTable, 'id')
  const hasEmail = await columnExists(connection, authUserTable, 'email')
  const hasName = await columnExists(connection, authUserTable, 'name')

  if (!hasId || !hasEmail) {
    logWarn('Skipped app_users backfill because the Better Auth user table is missing required columns', {
      sourceTable: authUserTable,
      hasId,
      hasEmail,
      hasName,
    })
    return { inserted: 0, sourceTable: authUserTable }
  }

  const selectSql = `
    SELECT id, email, ${hasName ? 'name' : 'NULL AS name'}
      FROM \`${authUserTable}\`
  `
  const [rows] = await connection.query(selectSql)

  let inserted = 0
  for (const row of rows) {
    await connection.execute(
      `INSERT INTO app_users (id, auth_user_id, email, name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         email = VALUES(email),
         name = VALUES(name)`,
      [row.id, row.id, row.email, row.name ?? null],
    )
    inserted += 1
  }

  return { inserted, sourceTable: authUserTable }
}

export async function ensureAppUserSchemaAndBackfill(connection) {
  try {
    await ensureAppUsersTable(connection)
    const result = await backfillAppUsers(connection)
    logInfo('Ensured app_users schema and backfill', result)
    return result
  } catch (error) {
    logError('Failed to ensure app_users schema and backfill', { error })
    throw error
  }
}
