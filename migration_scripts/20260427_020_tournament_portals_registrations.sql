-- Adds tournament portal support and authenticated Golf Homiez user tournament registration.
-- Safe to run repeatedly in MySQL 8+ environments.
-- tournament_id must match tournaments.id exactly (VARCHAR(191)) or MySQL rejects the FK with ER_FK_INCOMPATIBLE_COLUMNS.

CREATE TABLE IF NOT EXISTS tournament_registrations (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  tournament_id VARCHAR(191) NOT NULL,
  auth_user_id VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  name VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'registered',
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tournament_registrations_user (tournament_id, auth_user_id),
  KEY idx_tournament_registrations_tournament (tournament_id),
  KEY idx_tournament_registrations_email (email),
  KEY idx_tournament_registrations_correlation (correlation_id),
  CONSTRAINT fk_tournament_registrations_tournament
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE tournaments
  ADD COLUMN portal_slug VARCHAR(191) NULL;

CREATE INDEX idx_tournaments_portal_slug ON tournaments (portal_slug);
CREATE INDEX idx_tournaments_status_public ON tournaments (status, is_public);
