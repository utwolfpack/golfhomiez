-- Adds the non-sensitive billing details required by the onboarding and admin UI.
-- Access-code values are encrypted by the application before being stored; the
-- existing keyed hash remains the lookup value used during redemption.

SET @has_code_ciphertext := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_access_codes' AND COLUMN_NAME = 'code_ciphertext'
);
SET @sql := IF(
  @has_code_ciphertext = 0,
  'ALTER TABLE billing_access_codes ADD COLUMN code_ciphertext TEXT NULL AFTER code_hash',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_payment_brand := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_accounts' AND COLUMN_NAME = 'payment_method_brand'
);
SET @sql := IF(
  @has_payment_brand = 0,
  'ALTER TABLE billing_accounts ADD COLUMN payment_method_brand VARCHAR(32) NULL AFTER stripe_price_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_payment_last_four := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_accounts' AND COLUMN_NAME = 'payment_method_last_four'
);
SET @sql := IF(
  @has_payment_last_four = 0,
  'ALTER TABLE billing_accounts ADD COLUMN payment_method_last_four CHAR(4) NULL AFTER payment_method_brand',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_payment_exp_month := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_accounts' AND COLUMN_NAME = 'payment_method_exp_month'
);
SET @sql := IF(
  @has_payment_exp_month = 0,
  'ALTER TABLE billing_accounts ADD COLUMN payment_method_exp_month TINYINT UNSIGNED NULL AFTER payment_method_last_four',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_payment_exp_year := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_accounts' AND COLUMN_NAME = 'payment_method_exp_year'
);
SET @sql := IF(
  @has_payment_exp_year = 0,
  'ALTER TABLE billing_accounts ADD COLUMN payment_method_exp_year SMALLINT UNSIGNED NULL AFTER payment_method_exp_month',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
