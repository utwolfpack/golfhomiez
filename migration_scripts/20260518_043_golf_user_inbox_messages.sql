CREATE TABLE IF NOT EXISTS inbox_messages (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  message_type ENUM('message','challenge_request') NOT NULL DEFAULT 'message',
  sender_user_id VARCHAR(191) NULL,
  sender_email VARCHAR(191) NOT NULL,
  sender_name VARCHAR(191) NULL,
  recipient_user_id VARCHAR(191) NULL,
  recipient_email VARCHAR(191) NOT NULL,
  message_body TEXT NOT NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inbox_messages_recipient_user_read (recipient_user_id, read_at, created_at),
  INDEX idx_inbox_messages_recipient_email_read (recipient_email, read_at, created_at),
  INDEX idx_inbox_messages_sender_user (sender_user_id, created_at),
  INDEX idx_inbox_messages_type (message_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
