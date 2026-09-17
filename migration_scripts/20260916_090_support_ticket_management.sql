CREATE TABLE IF NOT EXISTS support_tickets (
  id CHAR(36) NOT NULL,
  account_type VARCHAR(32) NOT NULL,
  account_id VARCHAR(191) NOT NULL,
  requester_email VARCHAR(191) NOT NULL DEFAULT '',
  requester_name VARCHAR(255) NOT NULL DEFAULT '',
  subject VARCHAR(160) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  user_unread TINYINT(1) NOT NULL DEFAULT 0,
  admin_unread TINYINT(1) NOT NULL DEFAULT 1,
  metadata_json JSON NULL,
  correlation_id VARCHAR(191) NULL,
  last_message_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL DEFAULT NULL,
  closed_by_admin_id VARCHAR(191) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_tickets_requester_status (account_type, account_id, status, last_message_at),
  KEY idx_support_tickets_admin_queue (status, admin_unread, last_message_at),
  KEY idx_support_tickets_user_unread (account_type, account_id, user_unread)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id CHAR(36) NOT NULL,
  ticket_id CHAR(36) NOT NULL,
  sender_type VARCHAR(16) NOT NULL,
  sender_account_id VARCHAR(191) NULL,
  sender_email VARCHAR(191) NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  correlation_id VARCHAR(191) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_ticket_messages_ticket_created (ticket_id, created_at),
  KEY idx_support_ticket_messages_correlation (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
