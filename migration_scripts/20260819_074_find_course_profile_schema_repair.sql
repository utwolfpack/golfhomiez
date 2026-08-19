-- Repairs profile-summary score columns for environments where an older migration
-- was recorded as applied but the restored scores table no longer contains the
-- golf-course rating fields. This migration is intentionally idempotent.

SET @has_golf_course_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores' AND COLUMN_NAME = 'golf_course_id'
);
SET @sql := IF(
  @has_golf_course_id = 0,
  'ALTER TABLE scores ADD COLUMN golf_course_id VARCHAR(191) NULL AFTER course',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_course_rating := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores' AND COLUMN_NAME = 'course_rating'
);
SET @sql := IF(
  @has_course_rating = 0,
  'ALTER TABLE scores ADD COLUMN course_rating DECIMAL(4,1) NULL AFTER golf_course_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_slope_rating := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores' AND COLUMN_NAME = 'slope_rating'
);
SET @sql := IF(
  @has_slope_rating = 0,
  'ALTER TABLE scores ADD COLUMN slope_rating INT NULL AFTER course_rating',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_course_par := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores' AND COLUMN_NAME = 'course_par'
);
SET @sql := IF(
  @has_course_par = 0,
  'ALTER TABLE scores ADD COLUMN course_par INT NULL AFTER slope_rating',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_scores_course_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores' AND INDEX_NAME = 'idx_scores_golf_course_id'
);
SET @sql := IF(
  @has_scores_course_index = 0,
  'CREATE INDEX idx_scores_golf_course_id ON scores (golf_course_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
