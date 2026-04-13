CREATE TABLE IF NOT EXISTS app_users (
  id VARCHAR(191) PRIMARY KEY,
  auth_user_id VARCHAR(191) NOT NULL UNIQUE,
  email VARCHAR(191) NOT NULL,
  name VARCHAR(191) NULL,
  primary_city VARCHAR(191) NULL,
  primary_state VARCHAR(64) NULL,
  primary_zip_code VARCHAR(16) NULL,
  alcohol_preference VARCHAR(64) NULL,
  cannabis_preference VARCHAR(64) NULL,
  sobriety_preference VARCHAR(64) NULL,
  profile_enriched_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app_users_email (email),
  INDEX idx_app_users_enriched (profile_enriched_at)
);
