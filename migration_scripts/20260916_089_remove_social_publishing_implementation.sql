DROP TABLE IF EXISTS social_platform_connections;
DROP TABLE IF EXISTS social_publications;

UPDATE scheduled_jobs
   SET last_run_output_json = JSON_REMOVE(last_run_output_json, '$.socialPublishing')
 WHERE last_run_output_json IS NOT NULL
   AND JSON_VALID(last_run_output_json)
   AND JSON_CONTAINS_PATH(last_run_output_json, 'one', '$.socialPublishing') = 1;

UPDATE scheduled_job_runs
   SET output_json = JSON_REMOVE(output_json, '$.socialPublishing')
 WHERE output_json IS NOT NULL
   AND JSON_VALID(output_json)
   AND JSON_CONTAINS_PATH(output_json, 'one', '$.socialPublishing') = 1;
