SET @has_state_code := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_users'
    AND COLUMN_NAME = 'primary_state_code'
);

SET @backfill_sql := IF(
  @has_state_code > 0,
  'UPDATE app_users SET primary_state = COALESCE(NULLIF(primary_state, ), NULLIF(primary_state_code, )) WHERE COALESCE(NULLIF(primary_state, ), ) =  AND COALESCE(NULLIF(primary_state_code, ), ) <> ',
  'SELECT 1'
);
PREPARE backfill_stmt FROM @backfill_sql;
EXECUTE backfill_stmt;
DEALLOCATE PREPARE backfill_stmt;

SET @drop_sql := IF(
  @has_state_code > 0,
  'ALTER TABLE app_users DROP COLUMN primary_state_code',
  'SELECT 1'
);
PREPARE drop_stmt FROM @drop_sql;
EXECUTE drop_stmt;
DEALLOCATE PREPARE drop_stmt;
