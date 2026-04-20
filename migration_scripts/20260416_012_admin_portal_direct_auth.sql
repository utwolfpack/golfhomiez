CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(191) PRIMARY KEY,
  username VARCHAR(191) NOT NULL UNIQUE,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_salt VARCHAR(191) NOT NULL,
  password_hash VARCHAR(191) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id VARCHAR(191) PRIMARY KEY,
  admin_user_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(191) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_password_reset_lookup (admin_user_id, expires_at),
  CONSTRAINT fk_admin_password_reset_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS host_account_invites (
  id VARCHAR(191) PRIMARY KEY,
  invitee_email VARCHAR(191) NOT NULL,
  invitee_name VARCHAR(191) NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  security_key_hash VARCHAR(191) NOT NULL,
  invited_by_admin_id VARCHAR(191) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_host_invites_email (invitee_email, expires_at),
  CONSTRAINT fk_host_invites_admin FOREIGN KEY (invited_by_admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS host_accounts (
  id VARCHAR(191) PRIMARY KEY,
  auth_user_id VARCHAR(191) NOT NULL UNIQUE,
  email VARCHAR(191) NOT NULL UNIQUE,
  account_name VARCHAR(191) NOT NULL,
  invite_id VARCHAR(191) NOT NULL,
  is_validated TINYINT(1) NOT NULL DEFAULT 0,
  validated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_host_accounts_name (account_name),
  CONSTRAINT fk_host_accounts_invite FOREIGN KEY (invite_id) REFERENCES host_account_invites(id) ON DELETE RESTRICT
);

INSERT INTO admin_users (id, username, email, password_salt, password_hash, is_active)
SELECT
  'default_admin_account',
  'admin',
  'seanoldroyd.golfhomiez@outlook.com',
  'f1a2f0f1c6d44906a4dd4d16d4f7a355',
  '76455f08f5e7d764dd091333137ccb199b9537fa3a303050973b6135debf6741',
  1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_users WHERE username = 'admin'
);
