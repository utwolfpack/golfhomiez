-- Adds shared tournament-message dialogue threads used by hosts/organizers and registered golfers.
-- Each outbound tournament message creates a shared conversation for the selected recipients.
-- Player replies are visible to the original recipients but only create a new portal notification for the host.

SET @has_tournament_conversation_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND COLUMN_NAME = 'tournament_conversation_id'
);
SET @sql := IF(
  @has_tournament_conversation_id = 0,
  'ALTER TABLE inbox_messages ADD COLUMN tournament_conversation_id VARCHAR(191) NULL AFTER tournament_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_tournament_conversation_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbox_messages' AND INDEX_NAME = 'idx_inbox_messages_tournament_conversation'
);
SET @sql := IF(
  @has_tournament_conversation_index = 0,
  'CREATE INDEX idx_inbox_messages_tournament_conversation ON inbox_messages (tournament_conversation_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS tournament_message_threads (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  tournament_id VARCHAR(191) NOT NULL,
  tournament_name VARCHAR(255) NOT NULL,
  event_date DATE NULL,
  action_url VARCHAR(512) NULL,
  created_by_user_id VARCHAR(191) NULL,
  created_by_email VARCHAR(191) NULL,
  created_by_name VARCHAR(191) NULL,
  created_by_role VARCHAR(32) NOT NULL DEFAULT 'host',
  host_user_id VARCHAR(191) NULL,
  host_email VARCHAR(191) NULL,
  host_name VARCHAR(191) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_tournament_message_threads_tournament (tournament_id, updated_at),
  INDEX idx_tournament_message_threads_host_email (host_email, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_message_thread_members (
  thread_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NULL,
  email VARCHAR(191) NOT NULL,
  name VARCHAR(191) NULL,
  inbox_thread_id VARCHAR(191) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (thread_id, email),
  INDEX idx_tournament_message_thread_members_email (email, thread_id),
  INDEX idx_tournament_message_thread_members_inbox_thread (inbox_thread_id),
  CONSTRAINT fk_tournament_message_thread_members_thread
    FOREIGN KEY (thread_id) REFERENCES tournament_message_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_message_entries (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  thread_id VARCHAR(191) NOT NULL,
  sender_user_id VARCHAR(191) NULL,
  sender_email VARCHAR(191) NULL,
  sender_name VARCHAR(191) NULL,
  sender_role VARCHAR(32) NOT NULL DEFAULT 'user',
  message_body TEXT NOT NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_tournament_message_entries_thread_created (thread_id, created_at),
  INDEX idx_tournament_message_entries_sender_role (sender_role, created_at),
  INDEX idx_tournament_message_entries_correlation (correlation_id),
  CONSTRAINT fk_tournament_message_entries_thread
    FOREIGN KEY (thread_id) REFERENCES tournament_message_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_message_portal_state (
  viewer_key VARCHAR(384) NOT NULL,
  tournament_id VARCHAR(191) NOT NULL,
  last_read_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (viewer_key, tournament_id),
  INDEX idx_tournament_message_portal_state_read (tournament_id, last_read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
