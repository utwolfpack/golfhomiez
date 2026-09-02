CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id VARCHAR(191) NOT NULL PRIMARY KEY,
  stripe_customer_id VARCHAR(191) NULL UNIQUE,
  stripe_subscription_id VARCHAR(191) NULL UNIQUE,
  stripe_price_id VARCHAR(191) NULL,
  access_source ENUM('trial','stripe','legacy_free','code_free','complimentary_host','complimentary_organizer','none') NOT NULL DEFAULT 'trial',
  subscription_status VARCHAR(32) NULL,
  trial_started_at DATETIME NULL,
  trial_ends_at DATETIME NULL,
  current_period_ends_at DATETIME NULL,
  cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
  first_payment_failed_at DATETIME NULL,
  grace_ends_at DATETIME NULL,
  initial_trial_consumed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_billing_accounts_status (subscription_status),
  INDEX idx_billing_accounts_grace (grace_ends_at)
);

CREATE TABLE IF NOT EXISTS billing_access_codes (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  code_hash CHAR(64) NOT NULL UNIQUE,
  code_last_four VARCHAR(4) NOT NULL,
  label VARCHAR(191) NULL,
  max_redemptions INT UNSIGNED NULL,
  redemption_count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_admin_user_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_billing_access_codes_active_expiry (active, expires_at)
);

CREATE TABLE IF NOT EXISTS billing_access_code_redemptions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  access_code_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  redeemed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_billing_code_user (access_code_id, user_id),
  UNIQUE KEY uq_billing_user_permanent_grant (user_id),
  INDEX idx_billing_redemptions_code (access_code_id)
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id VARCHAR(191) NOT NULL PRIMARY KEY,
  event_type VARCHAR(191) NOT NULL,
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO billing_accounts
  (user_id, access_source, subscription_status, initial_trial_consumed, created_at, updated_at)
SELECT id, 'legacy_free', 'legacy_free', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM app_users
ON DUPLICATE KEY UPDATE user_id = VALUES(user_id);
