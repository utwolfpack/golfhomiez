CREATE TABLE IF NOT EXISTS role_definitions (
  role_key VARCHAR(64) NOT NULL PRIMARY KEY,
  display_name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  role_key VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_role_assignments_auth_user (auth_user_id),
  INDEX idx_user_role_assignments_email (email),
  INDEX idx_user_role_assignments_role_key (role_key),
  CONSTRAINT fk_user_role_assignments_role_key FOREIGN KEY (role_key) REFERENCES role_definitions(role_key)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  username VARCHAR(191) NOT NULL,
  email VARCHAR(191) NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_salt VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_users_username (username),
  UNIQUE KEY uq_admin_users_email (email)
);

CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  admin_user_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_password_reset_token_hash (token_hash),
  KEY idx_admin_password_reset_admin_user_id (admin_user_id),
  CONSTRAINT fk_admin_password_reset_admin_user FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS host_role_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  golf_course_name VARCHAR(191) NULL,
  account_name VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_role_accounts_auth_user_id (auth_user_id),
  KEY idx_host_role_accounts_email (email)
);

CREATE TABLE IF NOT EXISTS organizer_role_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  organizer_name VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_organizer_role_accounts_auth_user_id (auth_user_id),
  KEY idx_organizer_role_accounts_email (email)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(191) NULL,
  host_account_id VARCHAR(191) NULL,
  title VARCHAR(191) NOT NULL,
  description TEXT NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tournaments_organizer_account_id (organizer_account_id),
  KEY idx_tournaments_host_account_id (host_account_id)
);

CREATE TABLE IF NOT EXISTS host_account_invites (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  invitee_email VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  invitee_name VARCHAR(191) NULL,
  name VARCHAR(191) NULL,
  golf_course_name VARCHAR(191) NULL,
  account_name VARCHAR(191) NULL,
  course_name VARCHAR(191) NULL,
  security_key_hash VARCHAR(255) NULL,
  security_key VARCHAR(255) NULL,
  invited_by_admin_id VARCHAR(191) NULL,
  admin_user_id VARCHAR(191) NULL,
  expires_at DATETIME NULL,
  consumed_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_account_invites_email (invitee_email),
  KEY idx_host_account_invites_legacy_email (email),
  KEY idx_host_account_invites_admin_user_id (invited_by_admin_id),
  KEY idx_host_account_invites_expires_at (expires_at)
);

CREATE TABLE IF NOT EXISTS host_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  password_hash VARCHAR(255) NULL,
  password_salt VARCHAR(255) NULL,
  golf_course_name VARCHAR(191) NULL,
  account_name VARCHAR(191) NULL,
  course_name VARCHAR(191) NULL,
  name VARCHAR(191) NULL,
  invite_id VARCHAR(191) NULL,
  reset_email VARCHAR(191) NULL,
  is_validated TINYINT(1) NOT NULL DEFAULT 0,
  validated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_accounts_email (email),
  KEY idx_host_accounts_auth_user_id (auth_user_id),
  KEY idx_host_accounts_invite_id (invite_id)
);

CREATE TABLE IF NOT EXISTS host_sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NULL,
  host_id VARCHAR(191) NULL,
  account_id VARCHAR(191) NULL,
  token_hash VARCHAR(255) NULL,
  token VARCHAR(255) NULL,
  session_token VARCHAR(255) NULL,
  session_id VARCHAR(255) NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_sessions_host_account_id (host_account_id),
  KEY idx_host_sessions_token_hash (token_hash),
  KEY idx_host_sessions_token (token),
  KEY idx_host_sessions_session_token (session_token),
  KEY idx_host_sessions_session_id (session_id)
);

CREATE TABLE IF NOT EXISTS host_password_reset_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NULL,
  host_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  token_hash VARCHAR(255) NULL,
  token VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_host_password_reset_host_account_id (host_account_id),
  KEY idx_host_password_reset_email (email),
  KEY idx_host_password_reset_token_hash (token_hash),
  KEY idx_host_password_reset_token (token)
);

INSERT INTO role_definitions (role_key, display_name, description)
VALUES
  ('user', 'User', 'Access to public and self information'),
  ('host', 'Host – Golf Course', 'Access to golf course information'),
  ('organizer', 'Organizer', 'Access to organizer tournament information'),
  ('admin', 'Admin', 'Direct admin portal access')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;
