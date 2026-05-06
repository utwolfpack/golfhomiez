CREATE TABLE IF NOT EXISTS organizer_tournament_invites (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  tournament_id VARCHAR(191) NOT NULL,
  host_account_id VARCHAR(191) NOT NULL,
  organizer_email VARCHAR(191) NOT NULL,
  organizer_account_id VARCHAR(191) NULL,
  invite_token VARCHAR(191) NOT NULL,
  invite_url TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'issued',
  sent_at DATETIME NULL,
  accepted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_organizer_tournament_invites_tournament_id (tournament_id),
  KEY idx_organizer_tournament_invites_email (organizer_email),
  KEY idx_organizer_tournament_invites_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @has_tournament_identifier := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tournaments'
    AND COLUMN_NAME = 'tournament_identifier'
);
SET @sql := IF(
  @has_tournament_identifier = 0,
  'ALTER TABLE tournaments ADD COLUMN tournament_identifier VARCHAR(191) NULL AFTER host_account_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_organizer_email := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tournaments'
    AND COLUMN_NAME = 'organizer_email'
);
SET @sql := IF(
  @has_organizer_email = 0,
  'ALTER TABLE tournaments ADD COLUMN organizer_email VARCHAR(191) NULL AFTER tournament_identifier',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_identifier_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tournaments'
    AND INDEX_NAME = 'uq_tournaments_identifier'
);
SET @sql := IF(
  @has_identifier_index = 0,
  'ALTER TABLE tournaments ADD UNIQUE INDEX uq_tournaments_identifier (tournament_identifier)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_organizer_email_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tournaments'
    AND INDEX_NAME = 'idx_tournaments_organizer_email'
);
SET @sql := IF(
  @has_organizer_email_index = 0,
  'ALTER TABLE tournaments ADD INDEX idx_tournaments_organizer_email (organizer_email)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @organizer_account_nullable := (
  SELECT IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tournaments'
    AND COLUMN_NAME = 'organizer_account_id'
  LIMIT 1
);
SET @sql := IF(
  @organizer_account_nullable = 'NO',
  'ALTER TABLE tournaments MODIFY COLUMN organizer_account_id VARCHAR(191) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @start_date_nullable := (
  SELECT IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tournaments'
    AND COLUMN_NAME = 'start_date'
  LIMIT 1
);
SET @sql := IF(
  @start_date_nullable = 'NO',
  'ALTER TABLE tournaments MODIFY COLUMN start_date DATE NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @end_date_nullable := (
  SELECT IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tournaments'
    AND COLUMN_NAME = 'end_date'
  LIMIT 1
);
SET @sql := IF(
  @end_date_nullable = 'NO',
  'ALTER TABLE tournaments MODIFY COLUMN end_date DATE NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
