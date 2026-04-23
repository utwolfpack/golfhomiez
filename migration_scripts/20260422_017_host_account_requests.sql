CREATE TABLE IF NOT EXISTS host_account_requests (
  id VARCHAR(191) PRIMARY KEY,
  first_name VARCHAR(191) NOT NULL,
  last_name VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  state_code VARCHAR(32) NOT NULL,
  state_name VARCHAR(191) NOT NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  representative_details TEXT NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'pending',
  reviewed_by_admin_id VARCHAR(191) NULL,
  reviewed_by_email VARCHAR(191) NULL,
  reviewed_at DATETIME NULL,
  approved_host_account_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_host_account_requests_status_created (status, created_at),
  INDEX idx_host_account_requests_email (email)
);
