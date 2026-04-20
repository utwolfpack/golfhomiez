CREATE TABLE IF NOT EXISTS host_account_invites (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  invitee_name VARCHAR(191) NULL,
  golf_course_name VARCHAR(191) NULL,
  security_key_hash VARCHAR(255) NULL,
  security_key VARCHAR(191) NULL,
  register_url VARCHAR(1024) NULL,
  invited_by_admin_id VARCHAR(191) NULL,
  expires_at DATETIME NULL,
  consumed_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_host_invites_email (email),
  INDEX idx_host_invites_active (email, consumed_at, revoked_at, expires_at, created_at)
);

CREATE TABLE IF NOT EXISTS host_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_validated TINYINT(1) NOT NULL DEFAULT 1,
  validated_at DATETIME NULL,
  invite_id VARCHAR(191) NULL,
  reset_email VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_accounts_email (email)
);

CREATE TABLE IF NOT EXISTS host_sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_sessions_token_hash (token_hash),
  KEY idx_host_sessions_account (host_account_id),
  KEY idx_host_sessions_expires (expires_at)
);

CREATE TABLE IF NOT EXISTS host_password_reset_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_reset_token_hash (token_hash),
  KEY idx_host_reset_email (email),
  KEY idx_host_reset_host (host_account_id)
);

