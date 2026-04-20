import mysql from 'mysql2/promise'

let pool

function env(name, fallback = '') {
  return process.env[name] || fallback
}

export function getDbConfig() {
  return {
    host: env('DB_HOST', '127.0.0.1'),
    port: Number(env('DB_PORT', '3306')),
    user: env('DB_USER', 'golf_homiez_user'),
    password: env('DB_PASSWORD', 'change_me'),
    database: env('DB_NAME', 'golf_homiez'),
    waitForConnections: true,
    connectionLimit: Number(env('DB_POOL_SIZE', '10')),
    queueLimit: 0,
    multipleStatements: true,
  }
}

export function hasDbEnv() {
  const cfg = getDbConfig()
  return Boolean(cfg.host && cfg.user && cfg.database)
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool(getDbConfig())
  }
  return pool
}

export async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
