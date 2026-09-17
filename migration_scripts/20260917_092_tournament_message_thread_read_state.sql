-- Adds per-thread read state for host and organizer tournament-message conversations.
-- Existing tournament-level read markers remain the fallback so deployed environments
-- keep their previous read/unread state when this migration is applied.

CREATE TABLE IF NOT EXISTS tournament_message_thread_portal_state (
  viewer_key VARCHAR(384) NOT NULL,
  tournament_id VARCHAR(191) NOT NULL,
  thread_id VARCHAR(191) NOT NULL,
  last_read_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (viewer_key, thread_id),
  INDEX idx_tournament_message_thread_portal_tournament (viewer_key, tournament_id, last_read_at),
  INDEX idx_tournament_message_thread_portal_thread (thread_id, last_read_at),
  CONSTRAINT fk_tournament_message_thread_portal_thread
    FOREIGN KEY (thread_id) REFERENCES tournament_message_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
