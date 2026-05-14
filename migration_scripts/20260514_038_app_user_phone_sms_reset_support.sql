-- Adds golfer profile phone storage and organizer reset-token support for SMS password reset delivery.
ALTER TABLE app_users ADD COLUMN phone VARCHAR(64) NULL AFTER name;
ALTER TABLE app_users ADD COLUMN phone_updated_at DATETIME NULL AFTER phone;

CREATE TABLE IF NOT EXISTS organizer_password_reset_tokens (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_organizer_reset_account (organizer_account_id),
  INDEX idx_organizer_reset_token_hash (token_hash),
  INDEX idx_organizer_reset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
