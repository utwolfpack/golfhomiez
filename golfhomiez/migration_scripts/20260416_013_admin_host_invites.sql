INSERT INTO role_definitions (role_key, display_name)
VALUES
  ('admin', 'Admin')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS host_account_invites (
  id CHAR(32) NOT NULL,
  email VARCHAR(191) NOT NULL,
  invite_type VARCHAR(64) NOT NULL DEFAULT 'host_account',
  security_key_hash CHAR(64) NOT NULL,
  invite_url VARCHAR(1024) NULL,
  invited_by_auth_user_id VARCHAR(191) NULL,
  invited_by_email VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'issued',
  expires_at DATETIME NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_host_account_invites_email (email),
  KEY idx_host_account_invites_status (status),
  KEY idx_host_account_invites_email_status (email, status),
  CONSTRAINT chk_host_account_invites_type CHECK (invite_type IN ('host_account')),
  CONSTRAINT chk_host_account_invites_status CHECK (status IN ('issued', 'consumed', 'expired', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
