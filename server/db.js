import mysql from 'mysql2/promise'
import { getMigrations } from 'better-auth/db/migration'
import { ensureAppUserSchemaAndBackfill } from './lib/app-user-sync.js'
import { logError, logInfo } from './lib/logger.js'

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

async function ensureAuthSchema() {
  const { auth } = await import('./auth.js')
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

async function ensureAppTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(191) PRIMARY KEY,
      email VARCHAR(191) NOT NULL,
      name VARCHAR(191) NULL,
      auth_user_id VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_auth_user_id (auth_user_id)
    );

    CREATE TABLE IF NOT EXISTS teams (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id VARCHAR(191) PRIMARY KEY,
      team_id VARCHAR(191) NOT NULL,
      name VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      INDEX idx_team_members_team_id (team_id),
      CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scores (
      id VARCHAR(191) PRIMARY KEY,
      mode ENUM('team','solo') NOT NULL,
      date DATE NOT NULL,
      state VARCHAR(8) NOT NULL,
      course VARCHAR(191) NOT NULL,
      team VARCHAR(191) NULL,
      opponent_team VARCHAR(191) NULL,
      team_total INT NULL,
      opponent_total INT NULL,
      round_score INT NULL,
      money DECIMAL(10,2) NULL,
      won TINYINT NULL,
      holes_json JSON NULL,
      created_by_user_id VARCHAR(191) NOT NULL,
      created_by_email VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_scores_created_by (created_by_user_id),
      INDEX idx_scores_date (date),
      CONSTRAINT fk_scores_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
  `)
}

export async function initDb() {
  const db = getPool()
  try {
    await db.query('SELECT 1')
    await ensureAuthSchema()
    await ensureAppTables(db)
    await ensureAppUserSchemaAndBackfill()
    logInfo('Database initialization completed', { database: getDbConfig().database })
  } catch (error) {
    logError('Database initialization failed', { database: getDbConfig().database, error })
    throw error
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
