import mysql from 'mysql2/promise'
import { getMigrations } from 'better-auth/db/migration'
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

async function ensureAuthSchema() {
  const { auth } = await import('./auth.js')
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

async function ensureAppTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id VARCHAR(191) NOT NULL,
      team_id VARCHAR(191) NOT NULL,
      name VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'invited',
      verified TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (team_id, id),
      INDEX idx_team_members_team_id (team_id),
      INDEX idx_team_members_member_id (id),
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
      tee_color VARCHAR(16) NOT NULL DEFAULT 'white',
      money DECIMAL(10,2) NULL,
      won TINYINT NULL,
      holes_json JSON NULL,
      opponent_holes_json JSON NULL,
      created_by_user_id VARCHAR(191) NOT NULL,
      created_by_email VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_scores_created_by (created_by_user_id),
      INDEX idx_scores_date (date)
    );



    CREATE TABLE IF NOT EXISTS scorecard_hole_drafts (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      created_by_user_id VARCHAR(191) NOT NULL,
      created_by_email VARCHAR(191) NOT NULL,
      mode ENUM('team','solo') NOT NULL,
      scoring_side VARCHAR(16) NOT NULL DEFAULT 'team',
      date DATE NOT NULL,
      state VARCHAR(8) NOT NULL,
      course VARCHAR(191) NOT NULL,
      team VARCHAR(191) NULL,
      opponent_team VARCHAR(191) NULL,
      team_key VARCHAR(191) NOT NULL DEFAULT '',
      opponent_team_key VARCHAR(191) NOT NULL DEFAULT '',
      hole_number TINYINT UNSIGNED NOT NULL,
      par TINYINT UNSIGNED NULL,
      yards SMALLINT UNSIGNED NULL,
      stroke_index TINYINT UNSIGNED NULL,
      score INT NOT NULL,
      score_provided TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_scorecard_hole_drafts_context_lookup (created_by_user_id, mode, scoring_side, date, state, course(160), team_key(160), opponent_team_key(160)),
      INDEX idx_scorecard_hole_drafts_user_date (created_by_user_id, date),
      INDEX idx_scorecard_hole_drafts_course (state, course)
    );
  `)
}

export async function initDb() {
  const db = getPool()
  try {
    await db.query('SELECT 1')
    await ensureAuthSchema()
    await ensureAppTables(db)
    await runAppMigrations(db, {
      info(message) {
        logInfo(message)
      },
      warn(message) {
        logInfo(message, { levelOverride: 'warn' })
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
