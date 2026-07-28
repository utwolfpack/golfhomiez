CREATE TABLE IF NOT EXISTS tournament_team_scores (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  tournament_id VARCHAR(191) NOT NULL,
  team_key VARCHAR(255) NOT NULL,
  team_id VARCHAR(191) NULL,
  team_name VARCHAR(191) NOT NULL,
  total_score INT NULL,
  holes_json JSON NULL,
  tee_color VARCHAR(32) NOT NULL DEFAULT 'white',
  updated_by_auth_user_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tournament_team_scores_team (tournament_id, team_key),
  KEY idx_tournament_team_scores_tournament (tournament_id),
  KEY idx_tournament_team_scores_team_id (team_id),
  KEY idx_tournament_team_scores_updated (updated_at),
  KEY idx_tournament_team_scores_correlation (correlation_id),
  CONSTRAINT fk_tournament_team_scores_tournament
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
