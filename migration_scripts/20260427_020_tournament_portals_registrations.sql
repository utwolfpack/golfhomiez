-- Adds tournament portal support and authenticated Golf Homiez user tournament registration.
-- Safe to run repeatedly through the app migration runner. The runner checks existing
-- columns/indexes before emitting each ALTER/CREATE statement.
--
-- Important stage fix:
--   idx_tournaments_status_public requires both tournaments.status and tournaments.is_public.
--   Existing stage databases may already have tournaments without is_public, so the app
--   migration adds missing columns before creating the index.
--
-- The executable migration logic lives in server/migrations/index.js because MySQL cannot
-- safely express every required IF NOT EXISTS operation across all supported versions.
-- This file documents the desired final schema for review/deployment archives.

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

-- Final tournaments fields required by this migration:
--   portal_slug VARCHAR(191) NULL
--   status VARCHAR(32) NOT NULL DEFAULT 'draft'
--   is_public TINYINT(1) NOT NULL DEFAULT 0
--   INDEX idx_tournaments_portal_slug (portal_slug)
--   INDEX idx_tournaments_status_public (status, is_public)
