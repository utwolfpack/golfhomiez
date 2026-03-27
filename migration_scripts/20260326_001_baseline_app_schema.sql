CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(191) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_members (
  id VARCHAR(191) PRIMARY KEY,
  team_id VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  INDEX idx_team_members_team_id (team_id),
  CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scores (
  id VARCHAR(191) PRIMARY KEY,
  mode ENUM('team','solo') NOT NULL,
  date DATE NOT NULL,
  state VARCHAR(8) NOT NULL,
  course VARCHAR(191) NOT NULL,
  team VARCHAR(191) NULL,
  opponent_team VARCHAR(191) NULL,
  team_total INT NULL,
  opponent_total INT NULL,
  round_score INT NULL,
  money DECIMAL(10,2) NULL,
  won TINYINT NULL,
  holes_json JSON NULL,
  created_by_user_id VARCHAR(191) NOT NULL,
  created_by_email VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scores_created_by (created_by_user_id),
  INDEX idx_scores_date (date)
);
