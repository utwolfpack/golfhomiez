-- Adds configurable schedules and per-job configuration to the scheduled-jobs admin feature.
-- Applied automatically by npm install via npm run db:migrate.

ALTER TABLE scheduled_jobs
  ADD COLUMN schedule_type VARCHAR(16) NOT NULL DEFAULT 'manual' AFTER schedule_time_zone,
  ADD COLUMN schedule_time TIME NULL AFTER schedule_type,
  ADD COLUMN schedule_day_of_week TINYINT UNSIGNED NULL AFTER schedule_time,
  ADD COLUMN schedule_day_of_month TINYINT UNSIGNED NULL AFTER schedule_day_of_week,
  ADD COLUMN job_config_json LONGTEXT NULL AFTER schedule_day_of_month;

UPDATE scheduled_jobs
   SET schedule_type = 'daily',
       schedule_time = '02:00:00',
       schedule_day_of_week = NULL,
       schedule_day_of_month = NULL,
       schedule_label = 'Daily 02:00 MT'
 WHERE id = 'getTournaments';

UPDATE scheduled_jobs
   SET schedule_type = 'weekly',
       schedule_time = '18:00:00',
       schedule_day_of_week = 0,
       schedule_day_of_month = NULL,
       schedule_label = 'Weekly Sunday 18:00 MT'
 WHERE id = 'cancelled-tournament-cleanup';

CREATE INDEX idx_scheduled_jobs_schedule_type ON scheduled_jobs (schedule_type);
