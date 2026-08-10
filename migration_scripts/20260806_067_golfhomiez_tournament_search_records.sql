-- Preserves GolfHomiez-hosted tournament search records while the external discovery catalog refreshes.
-- Existing published GolfHomiez tournaments are backfilled into golf_course_tournaments.

SET @has_source_type := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'golf_course_tournaments' AND COLUMN_NAME = 'source_type'
);
SET @sql := IF(
  @has_source_type = 0,
  'ALTER TABLE golf_course_tournaments ADD COLUMN source_type VARCHAR(32) NOT NULL DEFAULT ''external'' AFTER correlation_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_golfhomiez_tournament_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'golf_course_tournaments' AND COLUMN_NAME = 'golfhomiez_tournament_id'
);
SET @sql := IF(
  @has_golfhomiez_tournament_id = 0,
  'ALTER TABLE golf_course_tournaments ADD COLUMN golfhomiez_tournament_id VARCHAR(191) NULL AFTER source_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE golf_course_tournaments
   SET source_type = 'external'
 WHERE source_type IS NULL OR TRIM(source_type) = '';

SET @has_golfhomiez_unique_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'golf_course_tournaments' AND INDEX_NAME = 'uq_golf_course_tournaments_golfhomiez_id'
);
SET @sql := IF(
  @has_golfhomiez_unique_index = 0,
  'CREATE UNIQUE INDEX uq_golf_course_tournaments_golfhomiez_id ON golf_course_tournaments (golfhomiez_tournament_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_active_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'golf_course_tournaments' AND INDEX_NAME = 'idx_golf_course_tournaments_source_active_date'
);
SET @sql := IF(
  @has_source_active_index = 0,
  'CREATE INDEX idx_golf_course_tournaments_source_active_date ON golf_course_tournaments (source_type, active, tournament_date)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO golf_course_tournaments
  (id, discovery_key, golf_course_id, golf_course_name, tournament_name, state_code, city, zip_code,
   tournament_date, tournament_website, source_url, discovered_text, active, first_seen_at, last_seen_at,
   correlation_id, source_type, golfhomiez_tournament_id)
SELECT
  LOWER(REPLACE(UUID(), '-', '')),
  SHA2(CONCAT('golfhomiez:', t.id), 256),
  COALESCE(gc.id, gcpp.golf_course_id, ha.golf_course_id),
  COALESCE(NULLIF(TRIM(gc.name), ''), NULLIF(TRIM(gcpp.golf_course_name), ''), NULLIF(TRIM(ha.golf_course_name), ''), NULLIF(TRIM(hra.golf_course_name), ''), 'Golf course'),
  t.name,
  COALESCE(NULLIF(TRIM(gc.state_code), ''), NULLIF(TRIM(gcpp.state_code), ''), ''),
  COALESCE(NULLIF(TRIM(gc.city), ''), NULLIF(TRIM(gcpp.city), '')),
  COALESCE(NULLIF(TRIM(gc.postal_code), ''), NULLIF(TRIM(gcpp.postal_code), '')),
  t.start_date,
  CONCAT('/tournaments/', COALESCE(NULLIF(TRIM(t.tournament_identifier), ''), t.id)),
  CONCAT('/tournaments/', COALESCE(NULLIF(TRIM(t.tournament_identifier), ''), t.id)),
  CONCAT_WS(' ', t.name, t.description),
  1,
  COALESCE(t.created_at, UTC_TIMESTAMP()),
  UTC_TIMESTAMP(),
  'migration-20260806-067',
  'golfhomiez',
  t.id
FROM tournaments t
LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
LEFT JOIN golf_course_public_pages gcpp ON gcpp.host_account_id = t.host_account_id
LEFT JOIN golf_courses gc ON gc.id = COALESCE(ha.golf_course_id, gcpp.golf_course_id)
WHERE LOWER(TRIM(COALESCE(t.status, ''))) = 'published'
  AND t.start_date IS NOT NULL
ON DUPLICATE KEY UPDATE
  golf_course_id = VALUES(golf_course_id),
  golf_course_name = VALUES(golf_course_name),
  tournament_name = VALUES(tournament_name),
  state_code = VALUES(state_code),
  city = VALUES(city),
  zip_code = VALUES(zip_code),
  tournament_date = VALUES(tournament_date),
  tournament_website = VALUES(tournament_website),
  source_url = VALUES(source_url),
  discovered_text = VALUES(discovered_text),
  active = 1,
  last_seen_at = UTC_TIMESTAMP(),
  correlation_id = VALUES(correlation_id),
  source_type = 'golfhomiez',
  golfhomiez_tournament_id = VALUES(golfhomiez_tournament_id);
