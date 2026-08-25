CREATE TABLE IF NOT EXISTS marketing_settings (
  setting_key VARCHAR(128) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by_admin_user_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_marketing_settings_updated_at (updated_at),
  INDEX idx_marketing_settings_correlation (correlation_id)
);

INSERT INTO marketing_settings (setting_key, setting_value)
VALUES
  ('home.golf_homiez_video_url', 'https://youtu.be/F9CrUZWAZJA'),
  ('home.golf_homiez_courses_video_url', 'https://youtu.be/F9CrUZWAZJA')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
