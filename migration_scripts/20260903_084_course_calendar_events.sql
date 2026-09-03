-- Adds public golf-course calendar events managed by golf-course host accounts.
CREATE TABLE IF NOT EXISTS golf_course_events (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  golf_course_public_page_id VARCHAR(64) NOT NULL,
  title VARCHAR(191) NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  details TEXT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  created_by_host_account_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_golf_course_events_page_date (golf_course_public_page_id, event_date, start_time),
  KEY idx_golf_course_events_public_date (is_public, event_date),
  KEY idx_golf_course_events_correlation (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
