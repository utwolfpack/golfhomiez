CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  schedule_label VARCHAR(191) NOT NULL,
  schedule_time_zone VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_run_at DATETIME NULL,
  last_run_id VARCHAR(64) NULL,
  last_run_triggered_by VARCHAR(32) NULL,
  last_run_status VARCHAR(32) NULL,
  last_run_started_at DATETIME NULL,
  last_run_completed_at DATETIME NULL,
  last_run_output_json LONGTEXT NULL,
  last_run_error TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_scheduled_jobs_next_run_at (next_run_at),
  INDEX idx_scheduled_jobs_last_status (last_run_status)
);

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  job_id VARCHAR(80) NOT NULL,
  triggered_by VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  correlation_id VARCHAR(128) NULL,
  admin_user_id VARCHAR(191) NULL,
  admin_user_email VARCHAR(191) NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  output_json LONGTEXT NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scheduled_job_runs_job_started (job_id, started_at),
  INDEX idx_scheduled_job_runs_correlation_id (correlation_id)
);
