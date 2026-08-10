-- Repairs cross-table identifier columns introduced by the golf-course public page,
-- GolfHomiez tournament search, and team start-schedule features.
-- Stage exposed a mixture of utf8mb4_general_ci and utf8mb4_bin identifier columns.
-- The app migration runner performs the same repair idempotently and also handles
-- partially applied migrations.

-- host_accounts.golf_course_id -> golf_courses.id
SET @sql := (
  SELECT CONCAT(
    'ALTER TABLE host_accounts MODIFY COLUMN golf_course_id ', UPPER(COLUMN_TYPE),
    IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET `', REPLACE(CHARACTER_SET_NAME, '`', '``'), '`')),
    IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE `', REPLACE(COLLATION_NAME, '`', '``'), '`')),
    ' NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'golf_courses' AND COLUMN_NAME = 'id'
  LIMIT 1
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- host_account_requests.golf_course_id -> golf_courses.id
SET @sql := (
  SELECT CONCAT(
    'ALTER TABLE host_account_requests MODIFY COLUMN golf_course_id ', UPPER(COLUMN_TYPE),
    IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET `', REPLACE(CHARACTER_SET_NAME, '`', '``'), '`')),
    IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE `', REPLACE(COLLATION_NAME, '`', '``'), '`')),
    ' NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'golf_courses' AND COLUMN_NAME = 'id'
  LIMIT 1
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- golf_course_public_pages.golf_course_id -> golf_courses.id
SET @sql := (
  SELECT CONCAT(
    'ALTER TABLE golf_course_public_pages MODIFY COLUMN golf_course_id ', UPPER(COLUMN_TYPE),
    IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET `', REPLACE(CHARACTER_SET_NAME, '`', '``'), '`')),
    IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE `', REPLACE(COLLATION_NAME, '`', '``'), '`')),
    ' NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'golf_courses' AND COLUMN_NAME = 'id'
  LIMIT 1
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- golf_course_public_pages.host_account_id -> host_accounts.id
SET @sql := (
  SELECT CONCAT(
    'ALTER TABLE golf_course_public_pages MODIFY COLUMN host_account_id ', UPPER(COLUMN_TYPE),
    IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET `', REPLACE(CHARACTER_SET_NAME, '`', '``'), '`')),
    IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE `', REPLACE(COLLATION_NAME, '`', '``'), '`')),
    ' NOT NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'host_accounts' AND COLUMN_NAME = 'id'
  LIMIT 1
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- golf_course_tournaments.golfhomiez_tournament_id -> tournaments.id
SET @sql := (
  SELECT CONCAT(
    'ALTER TABLE golf_course_tournaments MODIFY COLUMN golfhomiez_tournament_id ', UPPER(COLUMN_TYPE),
    IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET `', REPLACE(CHARACTER_SET_NAME, '`', '``'), '`')),
    IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE `', REPLACE(COLLATION_NAME, '`', '``'), '`')),
    ' NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tournaments' AND COLUMN_NAME = 'id'
  LIMIT 1
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- tournament_team_start_assignments.tournament_id -> tournaments.id.
SET @has_fk := (
  SELECT COUNT(*)
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tournament_team_start_assignments'
    AND CONSTRAINT_NAME = 'fk_tournament_team_start_tournament'
);
SET @sql := IF(
  @has_fk > 0,
  'ALTER TABLE tournament_team_start_assignments DROP FOREIGN KEY fk_tournament_team_start_tournament',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT CONCAT(
    'ALTER TABLE tournament_team_start_assignments MODIFY COLUMN tournament_id ', UPPER(COLUMN_TYPE),
    IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET `', REPLACE(CHARACTER_SET_NAME, '`', '``'), '`')),
    IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE `', REPLACE(COLLATION_NAME, '`', '``'), '`')),
    ' NOT NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tournaments' AND COLUMN_NAME = 'id'
  LIMIT 1
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE tournament_team_start_assignments
  ADD CONSTRAINT fk_tournament_team_start_tournament
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  ON DELETE CASCADE;

-- Re-run the GolfHomiez published-tournament backfill using byte comparisons so a
-- partially applied 067 migration cannot leave stage without search records.
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
  'migration-20260810-071',
  'golfhomiez',
  t.id
FROM tournaments t
LEFT JOIN host_role_accounts hra ON BINARY hra.id = BINARY t.host_account_id
LEFT JOIN host_accounts ha ON BINARY ha.id = BINARY t.host_account_id
LEFT JOIN golf_course_public_pages gcpp ON BINARY gcpp.host_account_id = BINARY t.host_account_id
LEFT JOIN golf_courses gc ON BINARY gc.id = BINARY COALESCE(ha.golf_course_id, gcpp.golf_course_id)
WHERE LOWER(TRIM(COALESCE(t.status, ''))) = 'published'
  AND t.start_date IS NOT NULL
  AND t.archived_at IS NULL
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

UPDATE golf_course_tournaments gct
JOIN tournaments t ON BINARY t.id = BINARY gct.golfhomiez_tournament_id
   SET gct.active = 0,
       gct.last_seen_at = UTC_TIMESTAMP(),
       gct.correlation_id = 'migration-20260810-071'
 WHERE gct.source_type = 'golfhomiez'
   AND t.archived_at IS NOT NULL;
