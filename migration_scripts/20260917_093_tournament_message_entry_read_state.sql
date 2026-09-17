-- Adds per-message read state for host/organizer tournament-message notifications.
-- Tournament-level and thread-level read timestamps remain valid fallbacks so existing
-- read state is preserved while allowing unread counters to decrement one message at a time.

CREATE TABLE IF NOT EXISTS tournament_message_entry_portal_state (
  viewer_key VARCHAR(384) NOT NULL,
  tournament_id VARCHAR(191) NOT NULL,
  thread_id VARCHAR(191) NOT NULL,
  message_id VARCHAR(191) NOT NULL,
  read_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (viewer_key, message_id),
  INDEX idx_tournament_message_entry_portal_tournament (viewer_key, tournament_id, read_at),
  INDEX idx_tournament_message_entry_portal_thread (viewer_key, thread_id, read_at),
  INDEX idx_tournament_message_entry_portal_message (message_id, read_at),
  CONSTRAINT fk_tournament_message_entry_portal_message
    FOREIGN KEY (message_id) REFERENCES tournament_message_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_message_entry_portal_thread
    FOREIGN KEY (thread_id) REFERENCES tournament_message_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
