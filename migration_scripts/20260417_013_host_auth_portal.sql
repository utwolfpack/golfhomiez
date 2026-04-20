CREATE TABLE IF NOT EXISTS host_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NOT NULL,
  account_name VARCHAR(191) NOT NULL,
  password_hash TEXT NOT NULL,
  invite_id VARCHAR(191) NULL,
  reset_email VARCHAR(191) NULL,
  is_validated TINYINT(1) NOT NULL DEFAULT 0,
  validated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_accounts_email (email),
  KEY idx_host_accounts_invite (invite_id),
  KEY idx_host_accounts_validated (is_validated)
);

CREATE TABLE IF NOT EXISTS host_sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_sessions_token_hash (token_hash),
  KEY idx_host_sessions_host_account (host_account_id),
  KEY idx_host_sessions_expires_at (expires_at)
);

CREATE TABLE IF NOT EXISTS host_password_reset_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_reset_token_hash (token_hash),
  KEY idx_host_reset_host_account (host_account_id),
  KEY idx_host_reset_email (email),
  KEY idx_host_reset_active (email, consumed_at, expires_at)
);
