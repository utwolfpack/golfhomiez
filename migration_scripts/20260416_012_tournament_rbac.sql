CREATE TABLE IF NOT EXISTS role_definitions (
  role_key VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO role_definitions (role_key, display_name)
VALUES
  ('user', 'User'),
  ('host', 'Host – Golf Course'),
  ('organizer', 'Organizer – organizes tournaments')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id VARCHAR(191) PRIMARY KEY,
  auth_user_id VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  role_key VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role_assignments_user_role (auth_user_id, role_key),
  KEY idx_user_role_assignments_email (email),
  KEY idx_user_role_assignments_role (role_key),
  CONSTRAINT fk_user_role_assignments_role FOREIGN KEY (role_key) REFERENCES role_definitions (role_key)
);

CREATE TABLE IF NOT EXISTS host_role_accounts (
  id VARCHAR(191) PRIMARY KEY,
  role_assignment_id VARCHAR(191) NOT NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  contact_name VARCHAR(191) NOT NULL,
  phone VARCHAR(64) NULL,
  website_url VARCHAR(255) NULL,
  city VARCHAR(191) NULL,
  state VARCHAR(64) NULL,
  postal_code VARCHAR(16) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_role_accounts_assignment (role_assignment_id),
  KEY idx_host_role_accounts_course (golf_course_name),
  CONSTRAINT fk_host_role_accounts_assignment FOREIGN KEY (role_assignment_id) REFERENCES user_role_assignments (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS organizer_role_accounts (
  id VARCHAR(191) PRIMARY KEY,
  role_assignment_id VARCHAR(191) NOT NULL,
  organization_name VARCHAR(191) NOT NULL,
  contact_name VARCHAR(191) NOT NULL,
  phone VARCHAR(64) NULL,
  website_url VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_organizer_role_accounts_assignment (role_assignment_id),
  KEY idx_organizer_role_accounts_name (organization_name),
  CONSTRAINT fk_organizer_role_accounts_assignment FOREIGN KEY (role_assignment_id) REFERENCES user_role_assignments (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tournaments (
  id VARCHAR(191) PRIMARY KEY,
  organizer_account_id VARCHAR(191) NOT NULL,
  host_account_id VARCHAR(191) NULL,
  name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'draft',
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  created_by_auth_user_id VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tournaments_organizer (organizer_account_id),
  KEY idx_tournaments_host (host_account_id),
  KEY idx_tournaments_public_start (is_public, start_date),
  CONSTRAINT fk_tournaments_organizer_account FOREIGN KEY (organizer_account_id) REFERENCES organizer_role_accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tournaments_host_account FOREIGN KEY (host_account_id) REFERENCES host_role_accounts (id) ON DELETE SET NULL
);

INSERT INTO user_role_assignments (id, auth_user_id, email, role_key, status)
SELECT REPLACE(UUID(), '-', ''), au.auth_user_id, au.email, 'user', 'active'
FROM app_users au
LEFT JOIN user_role_assignments ura
  ON ura.auth_user_id = au.auth_user_id
 AND ura.role_key = 'user'
WHERE ura.id IS NULL;
