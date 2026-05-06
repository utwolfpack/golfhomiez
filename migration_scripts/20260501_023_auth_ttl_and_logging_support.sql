-- Auth TTL and transaction logging support migration.
-- The 24-hour TTL is enforced by application configuration and refreshed on activity.
-- These indexes make expired-session cleanup and diagnostics efficient in production.

SET @db := DATABASE();

SET @idx := (
  SELECT COUNT(1)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'host_sessions'
    AND INDEX_NAME = 'idx_host_sessions_expires'
);
SET @sql := IF(@idx = 0, 'CREATE INDEX idx_host_sessions_expires ON host_sessions (expires_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(1)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'host_sessions'
    AND INDEX_NAME = 'idx_host_sessions_updated_at'
);
SET @sql := IF(@idx = 0, 'CREATE INDEX idx_host_sessions_updated_at ON host_sessions (updated_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(1)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'organizer_sessions'
    AND INDEX_NAME = 'idx_organizer_sessions_expires'
);
SET @sql := IF(@idx = 0 AND EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'organizer_sessions'), 'CREATE INDEX idx_organizer_sessions_expires ON organizer_sessions (expires_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DELETE FROM host_sessions WHERE expires_at IS NOT NULL AND expires_at <= NOW();
DELETE FROM organizer_sessions WHERE expires_at IS NOT NULL AND expires_at <= NOW();
