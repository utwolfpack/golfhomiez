import mysql from 'mysql2/promise'
import { logError, logInfo } from './lib/logger.js'
import { runAppMigrations } from './migrations/runner.js'

let pool

function requiredEnv(name, fallback = '') {
  return process.env[name] || fallback
}

export function getDbConfig() {
  return {
    host: requiredEnv('DB_HOST', '127.0.0.1'),
    port: Number(requiredEnv('DB_PORT', '3306')),
    user: requiredEnv('DB_USER', 'golf_homiez_user'),
    password: requiredEnv('DB_PASSWORD', 'change_me'),
    database: requiredEnv('DB_NAME', 'golf_homiez'),
    waitForConnections: true,
    connectionLimit: Number(requiredEnv('DB_POOL_SIZE', '10')),
    queueLimit: 0,
    multipleStatements: true,
    timezone: 'Z',
  }
}

export function getPool() {
  if (!pool) {
    const config = getDbConfig()
    pool = mysql.createPool(config)
    logInfo('Created MySQL pool', { host: config.host, port: config.port, database: config.database, connectionLimit: config.connectionLimit })
  }
  return pool
}

async function runBetterAuthMigrations() {
  const { auth } = await import('./auth.js')
  const { getMigrations } = await import('better-auth/db/migration')
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

export async function initDb() {
  const db = getPool()
  try {
    await db.query('SELECT 1')
    await runBetterAuthMigrations()
    await runAppMigrations(db, {
      info(message) {
        logInfo(message)
      },
      warn(message) {
        logInfo(message)
      },
    })
    logInfo('Database initialization complete')
  } catch (error) {
    logError('Database initialization failed', { error })
    throw error
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end()
    logInfo('Closed MySQL pool')
    pool = null
  }
}
