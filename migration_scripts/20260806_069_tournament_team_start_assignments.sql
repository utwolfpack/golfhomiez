-- Stores editable team start assignments for GolfHomiez tournaments.
-- The application migration runner in server/migrations/index.js performs
-- idempotent column, index, and foreign-key checks for existing databases.

CREATE TABLE IF NOT EXISTS tournament_team_start_assignments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  tournament_id VARCHAR(191) NOT NULL,
  team_key VARCHAR(255) NOT NULL,
  registration_id VARCHAR(191) NULL,
  team_id VARCHAR(191) NULL,
  team_name VARCHAR(191) NOT NULL,
  start_type VARCHAR(32) NOT NULL DEFAULT 'shotgun',
  start_time TIME NOT NULL,
  starting_hole VARCHAR(12) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  notes VARCHAR(500) NULL,
  updated_by_auth_user_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tournament_team_start_assignment (tournament_id, team_key),
  KEY idx_tournament_team_start_schedule (tournament_id, sort_order, start_time),
  KEY idx_tournament_team_start_registration (registration_id),
  KEY idx_tournament_team_start_correlation (correlation_id),
  CONSTRAINT fk_tournament_team_start_tournament
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
