-- Repairs organizer session schema for environments where organizer_sessions existed
-- before token_hash was added. Run this after 20260427_021_separate_organizer_auth.sql
-- and before deploying or restarting the updated server.

SET @schema_name = DATABASE();

CREATE TABLE IF NOT EXISTS organizer_sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_organizer_sessions_account (organizer_account_id),
  INDEX idx_organizer_sessions_token_hash (token_hash),
  INDEX idx_organizer_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'organizer_sessions' AND COLUMN_NAME = 'token_hash'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE organizer_sessions ADD COLUMN token_hash VARCHAR(255) NULL',
  'SELECT "organizer_sessions.token_hash already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE organizer_sessions
SET token_hash = SHA2(id, 256)
WHERE token_hash IS NULL OR token_hash = '';

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'organizer_sessions' AND INDEX_NAME = 'idx_organizer_sessions_token_hash'
);
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_organizer_sessions_token_hash ON organizer_sessions (token_hash)',
  'SELECT "idx_organizer_sessions_token_hash already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'organizer_sessions' AND INDEX_NAME = 'idx_organizer_sessions_account'
);
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_organizer_sessions_account ON organizer_sessions (organizer_account_id)',
  'SELECT "idx_organizer_sessions_account already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'organizer_sessions' AND INDEX_NAME = 'idx_organizer_sessions_expires'
);
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_organizer_sessions_expires ON organizer_sessions (expires_at)',
  'SELECT "idx_organizer_sessions_expires already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
