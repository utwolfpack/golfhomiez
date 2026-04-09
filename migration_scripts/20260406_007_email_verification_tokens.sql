CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  email VARCHAR(191) NOT NULL,
  token VARCHAR(128) NOT NULL,
  callback_path VARCHAR(512) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  revoked_at DATETIME NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_verification_tokens_token (token),
  KEY idx_email_verification_tokens_email (email),
  KEY idx_email_verification_tokens_user_id (user_id),
  KEY idx_email_verification_tokens_active (email, consumed_at, revoked_at, expires_at)
);
