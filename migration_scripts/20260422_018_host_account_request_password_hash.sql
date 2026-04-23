CREATE TABLE IF NOT EXISTS host_account_requests (
  id VARCHAR(191) NOT NULL,
  first_name VARCHAR(191) NOT NULL,
  last_name VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  state_code VARCHAR(32) NOT NULL,
  state_name VARCHAR(191) NOT NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  representative_details TEXT NOT NULL,
  requested_password_hash VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  reviewed_by_admin_id VARCHAR(191) NULL,
  reviewed_by_email VARCHAR(191) NULL,
  reviewed_at DATETIME NULL,
  approved_host_account_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_host_account_requests_status_created (status, created_at),
  KEY idx_host_account_requests_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @host_req_pwd_hash_col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'host_account_requests'
    AND COLUMN_NAME = 'requested_password_hash'
);

SET @host_req_pwd_hash_sql := IF(
  @host_req_pwd_hash_col_exists = 0,
  'ALTER TABLE host_account_requests ADD COLUMN requested_password_hash VARCHAR(255) NULL AFTER representative_details',
  'SELECT 1'
);

PREPARE host_req_pwd_hash_stmt FROM @host_req_pwd_hash_sql;
EXECUTE host_req_pwd_hash_stmt;
DEALLOCATE PREPARE host_req_pwd_hash_stmt;
