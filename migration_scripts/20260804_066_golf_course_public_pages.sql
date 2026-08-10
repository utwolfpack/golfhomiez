-- Creates persistent public GolfHomiez pages for approved golf-course host accounts.
-- Public page URLs use the unique slug column and remain stable after host profile edits.

SET @has_host_golf_course_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'host_accounts' AND COLUMN_NAME = 'golf_course_id'
);
SET @sql := IF(
  @has_host_golf_course_id = 0,
  'ALTER TABLE host_accounts ADD COLUMN golf_course_id VARCHAR(64) NULL AFTER auth_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_request_golf_course_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'host_account_requests' AND COLUMN_NAME = 'golf_course_id'
);
SET @sql := IF(
  @has_request_golf_course_id = 0,
  'ALTER TABLE host_account_requests ADD COLUMN golf_course_id VARCHAR(64) NULL AFTER golf_course_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS golf_course_public_pages (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NOT NULL,
  golf_course_id VARCHAR(64) NULL,
  slug VARCHAR(191) NOT NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  summary TEXT NULL,
  banner_image_url VARCHAR(1024) NULL,
  website_url VARCHAR(1024) NULL,
  contact_phone VARCHAR(64) NULL,
  address_line1 VARCHAR(255) NULL,
  city VARCHAR(128) NULL,
  state_code VARCHAR(8) NOT NULL,
  postal_code VARCHAR(32) NULL,
  source_website_url VARCHAR(1024) NULL,
  source_last_synced_at DATETIME NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_golf_course_public_pages_host (host_account_id),
  UNIQUE KEY uq_golf_course_public_pages_slug (slug),
  KEY idx_golf_course_public_pages_course (golf_course_id),
  KEY idx_golf_course_public_pages_state (state_code, golf_course_name),
  KEY idx_golf_course_public_pages_published (is_published, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @has_host_golf_course_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'host_accounts' AND INDEX_NAME = 'idx_host_accounts_golf_course_id'
);
SET @sql := IF(
  @has_host_golf_course_index = 0,
  'CREATE INDEX idx_host_accounts_golf_course_id ON host_accounts (golf_course_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_request_golf_course_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'host_account_requests' AND INDEX_NAME = 'idx_host_account_requests_golf_course_id'
);
SET @sql := IF(
  @has_request_golf_course_index = 0,
  'CREATE INDEX idx_host_account_requests_golf_course_id ON host_account_requests (golf_course_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
