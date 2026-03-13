import mysql from 'mysql2/promise'

let pool

function requiredEnv(name, fallback = '') {
  return process.env[name] || fallback
}

export function getDbConfig() {
  return {
    host: requiredEnv('DB_HOST', '127.0.0.1'),
    port: Number(requiredEnv('DB_PORT', '3306')),
    user: requiredEnv('DB_USER', ''),
    password: requiredEnv('DB_PASSWORD', ''),
    database: requiredEnv('DB_NAME', ''),
    waitForConnections: true,
    connectionLimit: Number(requiredEnv('DB_POOL_SIZE', '10')),
    queueLimit: 0,
    multipleStatements: true,
  }
}

export function hasDbEnv() {
  return Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME)
}

export async function getPool() {
  if (!pool) {
    const cfg = getDbConfig()
    if (!cfg.user || !cfg.database) {
      throw new Error('Missing DB connection environment variables. Set DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.')
    }
    pool = mysql.createPool(cfg)
  }
  return pool
}

export async function initDb() {
  const db = await getPool()
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(191) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL,
      password_updated_at DATETIME NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(128) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      created_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      INDEX idx_sessions_user_id (user_id),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id VARCHAR(36) PRIMARY KEY,
      token VARCHAR(128) NOT NULL UNIQUE,
      user_id VARCHAR(36) NOT NULL,
      created_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      INDEX idx_password_resets_user_id (user_id),
      CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS teams (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      created_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id VARCHAR(36) PRIMARY KEY,
      team_id VARCHAR(36) NOT NULL,
      name VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      INDEX idx_team_members_team_id (team_id),
      CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scores (
      id VARCHAR(36) PRIMARY KEY,
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
      created_by_user_id VARCHAR(36) NOT NULL,
      created_by_email VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX idx_scores_created_by (created_by_user_id),
      INDEX idx_scores_date (date),
      CONSTRAINT fk_scores_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
  `)
}

export async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
