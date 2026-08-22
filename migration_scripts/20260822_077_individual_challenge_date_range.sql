-- Adds an optional end date for Individual Challenges so a challenge can span up to one month.
-- Idempotent for repeated deployment runs.

SET @has_challenge_end_date := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'inbox_messages'
     AND COLUMN_NAME = 'challenge_end_date'
);
SET @sql := IF(
  @has_challenge_end_date = 0,
  'ALTER TABLE inbox_messages ADD COLUMN challenge_end_date DATE NULL AFTER challenge_date',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
