-- Adds the unified notification inbox, soft-delete/read state, user message groups,
-- and tournament messaging metadata. Intentionally idempotent for deployment use.

ALTER TABLE inbox_messages MODIFY COLUMN message_type VARCHAR(32) NOT NULL DEFAULT 'message';
ALTER TABLE inbox_messages MODIFY COLUMN recipient_email VARCHAR(191) NULL;
ALTER TABLE inbox_messages MODIFY COLUMN created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);

SET @has_sender_role := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND COLUMN_NAME = 'sender_role');
SET @sql := IF(@has_sender_role = 0, 'ALTER TABLE inbox_messages ADD COLUMN sender_role VARCHAR(32) NULL AFTER sender_name', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_group_id := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND COLUMN_NAME = 'group_id');
SET @sql := IF(@has_group_id = 0, 'ALTER TABLE inbox_messages ADD COLUMN group_id VARCHAR(191) NULL AFTER recipient_email', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_tournament_id := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND COLUMN_NAME = 'tournament_id');
SET @sql := IF(@has_tournament_id = 0, 'ALTER TABLE inbox_messages ADD COLUMN tournament_id VARCHAR(191) NULL AFTER group_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_tournament_name := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND COLUMN_NAME = 'tournament_name');
SET @sql := IF(@has_tournament_name = 0, 'ALTER TABLE inbox_messages ADD COLUMN tournament_name VARCHAR(255) NULL AFTER tournament_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_event_date := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND COLUMN_NAME = 'event_date');
SET @sql := IF(@has_event_date = 0, 'ALTER TABLE inbox_messages ADD COLUMN event_date DATE NULL AFTER tournament_name', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_action_url := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND COLUMN_NAME = 'action_url');
SET @sql := IF(@has_action_url = 0, 'ALTER TABLE inbox_messages ADD COLUMN action_url VARCHAR(512) NULL AFTER event_date', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_correlation_id := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND COLUMN_NAME = 'correlation_id');
SET @sql := IF(@has_correlation_id = 0, 'ALTER TABLE inbox_messages ADD COLUMN correlation_id VARCHAR(191) NULL AFTER action_url', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_group_index := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND INDEX_NAME = 'idx_inbox_messages_group_created');
SET @sql := IF(@has_group_index = 0, 'CREATE INDEX idx_inbox_messages_group_created ON inbox_messages (group_id, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_tournament_index := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND INDEX_NAME = 'idx_inbox_messages_tournament_created');
SET @sql := IF(@has_tournament_index = 0, 'CREATE INDEX idx_inbox_messages_tournament_created ON inbox_messages (tournament_id, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_correlation_index := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND INDEX_NAME = 'idx_inbox_messages_correlation');
SET @sql := IF(@has_correlation_index = 0, 'CREATE INDEX idx_inbox_messages_correlation ON inbox_messages (correlation_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS inbox_thread_user_state (
  user_key VARCHAR(384) NOT NULL,
  thread_id VARCHAR(191) NOT NULL,
  last_read_at DATETIME NULL,
  deleted_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_key, thread_id),
  INDEX idx_inbox_thread_user_state_deleted (user_key, deleted_at, updated_at),
  INDEX idx_inbox_thread_user_state_read (user_key, last_read_at, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO inbox_thread_user_state (user_key, thread_id, deleted_at, updated_at)
SELECT LEFT(user_key, 384), thread_id, deleted_at, updated_at
  FROM inbox_challenge_user_state
 WHERE deleted_at IS NOT NULL
ON DUPLICATE KEY UPDATE deleted_at = VALUES(deleted_at), updated_at = VALUES(updated_at);

CREATE TABLE IF NOT EXISTS message_groups (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  created_by_user_id VARCHAR(191) NULL,
  created_by_email VARCHAR(191) NOT NULL,
  created_by_name VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_message_groups_creator (created_by_email, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS message_group_members (
  group_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NULL,
  email VARCHAR(191) NOT NULL,
  name VARCHAR(191) NULL,
  joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  left_at DATETIME(6) NULL,
  removed_by_user_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, email),
  INDEX idx_message_group_members_email (email, left_at, joined_at),
  INDEX idx_message_group_members_group_active (group_id, left_at, joined_at),
  CONSTRAINT fk_message_group_members_group FOREIGN KEY (group_id) REFERENCES message_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
