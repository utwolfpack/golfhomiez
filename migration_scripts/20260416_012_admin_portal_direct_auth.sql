CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  username VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  password_hash TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_users_username (username),
  UNIQUE KEY uq_admin_users_email (email),
  KEY idx_admin_users_active (is_active)
);

CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  admin_user_id VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_reset_token_hash (token_hash),
  KEY idx_admin_reset_admin_user (admin_user_id),
  KEY idx_admin_reset_email (email),
  KEY idx_admin_reset_active (email, consumed_at, expires_at)
);

CREATE TABLE IF NOT EXISTS host_account_invites (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  invitee_name VARCHAR(191) NULL,
  golf_course_name VARCHAR(191) NULL,
  security_key_hash VARCHAR(255) NOT NULL,
  invited_by_admin_id VARCHAR(191) NULL,
  expires_at DATETIME NULL,
  consumed_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_host_invites_email (email),
  KEY idx_host_invites_admin (invited_by_admin_id),
  KEY idx_host_invites_active (email, consumed_at, revoked_at, expires_at)
);
