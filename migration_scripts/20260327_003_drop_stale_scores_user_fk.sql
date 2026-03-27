SET @scores_table_exists := (
  SELECT COUNT(*)
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name = 'scores'
);

SET @fk_scores_user_exists := (
  SELECT COUNT(*)
    FROM information_schema.referential_constraints
   WHERE constraint_schema = DATABASE()
     AND table_name = 'scores'
     AND constraint_name = 'fk_scores_user'
);

SET @sql := IF(@scores_table_exists = 1 AND @fk_scores_user_exists = 1,
  'ALTER TABLE scores DROP FOREIGN KEY fk_scores_user',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
