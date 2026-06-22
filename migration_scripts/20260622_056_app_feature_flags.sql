CREATE TABLE IF NOT EXISTS app_feature_flags (
  flag_key VARCHAR(128) PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  description VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app_feature_flags_enabled (enabled)
);

INSERT INTO app_feature_flags (flag_key, enabled, description)
VALUES (
  'profileSocialPreferences',
  0,
  'Shows alcohol, 420, and sobriety profile preference fields and saves preference updates.'
)
ON DUPLICATE KEY UPDATE
  description = VALUES(description);
