-- Adds independent organizer authentication storage.
-- Run against the production database before deploying the app changes.

SET @schema_name = DATABASE();

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'organizer_role_accounts' AND COLUMN_NAME = 'password_hash'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE organizer_role_accounts ADD COLUMN password_hash VARCHAR(255) NULL',
  'SELECT "organizer_role_accounts.password_hash already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'organizer_role_accounts' AND COLUMN_NAME = 'reset_email'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE organizer_role_accounts ADD COLUMN reset_email VARCHAR(191) NULL',
  'SELECT "organizer_role_accounts.reset_email already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'organizer_role_accounts' AND INDEX_NAME = 'idx_organizer_role_accounts_email_direct'
);
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_organizer_role_accounts_email_direct ON organizer_role_accounts (email)',
  'SELECT "idx_organizer_role_accounts_email_direct already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS organizer_sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_organizer_sessions_account (organizer_account_id),
  INDEX idx_organizer_sessions_token_hash (token_hash),
  INDEX idx_organizer_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
