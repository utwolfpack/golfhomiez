import mysql from 'mysql2/promise'

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
    pool = mysql.createPool(getDbConfig())
  }
  return pool
}


export async function initDb() {
  const db = getPool()
  await db.query('SELECT 1')
}

export async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
