-- Persists external API call counts for admin reporting across application releases.
-- Counts calls to providers outside the GolfHomiez application such as Golfbert and Brevo.

CREATE TABLE IF NOT EXISTS external_api_call_metrics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  api_type VARCHAR(32) NOT NULL,
  endpoint VARCHAR(512) NOT NULL,
  method VARCHAR(16) NOT NULL DEFAULT 'GET',
  status_code SMALLINT UNSIGNED NULL,
  ok TINYINT(1) NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NULL,
  correlation_id VARCHAR(191) NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_external_api_call_metrics_occurred_at (occurred_at),
  INDEX idx_external_api_call_metrics_api_date (api_type, occurred_at),
  INDEX idx_external_api_call_metrics_endpoint (endpoint(128)),
  INDEX idx_external_api_call_metrics_api_endpoint_date (api_type, endpoint(128), occurred_at)
);
