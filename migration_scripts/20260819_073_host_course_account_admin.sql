ALTER TABLE host_accounts
  ADD COLUMN is_course_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER notes,
  ADD COLUMN created_by_host_account_id VARCHAR(191) NULL AFTER is_course_admin;

CREATE INDEX idx_host_accounts_course_admin ON host_accounts (golf_course_id, is_course_admin);

UPDATE host_accounts target
JOIN (
  SELECT first_hosts.id
  FROM (
    SELECT candidate.id,
           COALESCE(NULLIF(TRIM(candidate.golf_course_id), ''), CONCAT('name:', LOWER(TRIM(COALESCE(NULLIF(candidate.account_name, ''), candidate.id))))) AS course_key
      FROM host_accounts candidate
     WHERE candidate.is_validated = 1
       AND NOT EXISTS (
         SELECT 1
           FROM host_accounts earlier
          WHERE earlier.is_validated = 1
            AND COALESCE(NULLIF(TRIM(earlier.golf_course_id), ''), CONCAT('name:', LOWER(TRIM(COALESCE(NULLIF(earlier.account_name, ''), earlier.id))))) =
                COALESCE(NULLIF(TRIM(candidate.golf_course_id), ''), CONCAT('name:', LOWER(TRIM(COALESCE(NULLIF(candidate.account_name, ''), candidate.id)))))
            AND (
              earlier.created_at < candidate.created_at
              OR (earlier.created_at = candidate.created_at AND earlier.id < candidate.id)
            )
       )
  ) first_hosts
  LEFT JOIN host_accounts existing_admin
    ON existing_admin.is_course_admin = 1
   AND COALESCE(NULLIF(TRIM(existing_admin.golf_course_id), ''), CONCAT('name:', LOWER(TRIM(COALESCE(NULLIF(existing_admin.account_name, ''), existing_admin.id))))) = first_hosts.course_key
 WHERE existing_admin.id IS NULL
) admins_to_seed ON admins_to_seed.id = target.id
SET target.is_course_admin = 1,
    target.updated_at = CURRENT_TIMESTAMP;
