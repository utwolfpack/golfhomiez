CREATE TABLE IF NOT EXISTS organizer_auth_accounts (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  contact_name VARCHAR(191) NULL,
  organization_name VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_organizer_auth_accounts_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS organizer_sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_organizer_sessions_account (organizer_account_id),
  KEY idx_organizer_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'organizer_auth_accounts'
    AND COLUMN_NAME = 'contact_name'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE organizer_auth_accounts ADD COLUMN contact_name VARCHAR(191) NULL AFTER password_hash',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'organizer_auth_accounts'
    AND COLUMN_NAME = 'organization_name'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE organizer_auth_accounts ADD COLUMN organization_name VARCHAR(191) NULL AFTER contact_name',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'organizer_auth_accounts'
    AND INDEX_NAME = 'uq_organizer_auth_accounts_email'
);
SET @sql := IF(@index_exists = 0,
  'ALTER TABLE organizer_auth_accounts ADD UNIQUE INDEX uq_organizer_auth_accounts_email (email)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
