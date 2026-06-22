-- Require golf user location completion during the first profile enrichment flow.
-- Existing users that were previously marked enriched without a full profile location
-- are moved back into the one-time profile setup gate on their next sign-in.
UPDATE app_users
   SET profile_enriched_at = NULL,
       updated_at = NOW()
 WHERE profile_enriched_at IS NOT NULL
   AND (
     phone IS NULL OR TRIM(phone) = '' OR
     primary_city IS NULL OR TRIM(primary_city) = '' OR
     primary_state IS NULL OR TRIM(primary_state) = '' OR
     primary_zip_code IS NULL OR TRIM(primary_zip_code) = ''
   );
