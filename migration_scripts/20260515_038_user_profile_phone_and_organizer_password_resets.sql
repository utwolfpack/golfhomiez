-- Adds required golfer profile phone support and organizer password reset tokens.
-- Applied automatically by npm install via npm run db:migrate.

ALTER TABLE app_users ADD COLUMN phone VARCHAR(64) NULL AFTER name;

CREATE TABLE IF NOT EXISTS organizer_password_reset_tokens (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_organizer_password_reset_account (organizer_account_id),
  INDEX idx_organizer_password_reset_token (token_hash),
  INDEX idx_organizer_password_reset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
