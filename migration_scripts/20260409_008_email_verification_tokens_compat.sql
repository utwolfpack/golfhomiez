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

SET @evt_user_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'email_verification_tokens'
    AND constraint_name = 'fk_email_verification_tokens_user'
);
SET @evt_drop_fk_sql := IF(
  @evt_user_fk_exists > 0,
  'ALTER TABLE email_verification_tokens DROP FOREIGN KEY fk_email_verification_tokens_user',
  'SELECT 1'
);
PREPARE evt_stmt FROM @evt_drop_fk_sql;
EXECUTE evt_stmt;
DEALLOCATE PREPARE evt_stmt;

ALTER TABLE email_verification_tokens
  MODIFY COLUMN user_id VARCHAR(255) NOT NULL;
