CREATE TABLE IF NOT EXISTS inbox_challenge_user_state (
  user_key VARCHAR(512) NOT NULL,
  thread_id VARCHAR(191) NOT NULL,
  deleted_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_key, thread_id),
  INDEX idx_inbox_challenge_user_state_deleted (user_key, deleted_at, updated_at)
);
