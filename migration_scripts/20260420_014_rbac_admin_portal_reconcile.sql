CREATE TABLE IF NOT EXISTS role_definitions (
  role_key VARCHAR(64) NOT NULL PRIMARY KEY,
  display_name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO role_definitions (role_key, display_name, description) VALUES
  ('user', 'User', 'Access to publicly available information and the logged in user profile'),
  ('host', 'Host – Golf Course', 'Access to all golf course information'),
  ('organizer', 'Organizer', 'Access to tournament information for tournaments organized by the logged in user'),
  ('admin', 'Admin', 'Full access to admin portal and application information')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  role_key VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_role_assignments_auth_user (auth_user_id),
  KEY idx_user_role_assignments_email (email),
  KEY idx_user_role_assignments_role_status (role_key, status),
  UNIQUE KEY uq_user_role_assignments_auth_role (auth_user_id, role_key)
);

CREATE TABLE IF NOT EXISTS host_role_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NOT NULL,
  golf_course_name VARCHAR(191) NULL,
  account_name VARCHAR(191) NULL,
  is_validated TINYINT(1) NOT NULL DEFAULT 0,
  validated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_role_accounts_auth_user (auth_user_id),
  KEY idx_host_role_accounts_email (email)
);

CREATE TABLE IF NOT EXISTS organizer_role_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NOT NULL,
  display_name VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_organizer_role_accounts_auth_user (auth_user_id),
  KEY idx_organizer_role_accounts_email (email)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(191) NULL,
  host_account_id VARCHAR(191) NULL,
  name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  course_name VARCHAR(191) NULL,
  start_date DATETIME NULL,
  end_date DATETIME NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tournaments_organizer (organizer_account_id),
  KEY idx_tournaments_host (host_account_id),
  KEY idx_tournaments_status (status)
);
