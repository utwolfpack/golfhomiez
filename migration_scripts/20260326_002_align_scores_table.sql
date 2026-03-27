SET @mode_exists := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'scores'
     AND column_name = 'mode'
);
SET @sql := IF(@mode_exists = 0,
  'ALTER TABLE scores ADD COLUMN mode ENUM(\'team\',\'solo\') NOT NULL DEFAULT \'team\' AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @holes_exists := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'scores'
     AND column_name = 'holes_json'
);
SET @sql := IF(@holes_exists = 0,
  'ALTER TABLE scores ADD COLUMN holes_json JSON NULL AFTER won',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @scores_date_idx_exists := (
  SELECT COUNT(*)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'scores'
     AND index_name = 'idx_scores_date'
);
SET @sql := IF(@scores_date_idx_exists = 0,
  'ALTER TABLE scores ADD INDEX idx_scores_date (date)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
