-- Manual data reset script: all organizer accounts.
-- Purpose: create a clean data environment by deleting all organizer accounts and organizer-owned tournament data.
-- This script is intentionally NOT registered in server/migrations/index.js and is NOT run by npm install.
-- Usage: set both confirmation variables to YES, review in a non-production clone first, then execute manually.
-- Collation note: comparisons explicitly normalize to utf8mb4_general_ci to avoid mixed-collation failures on upgraded MySQL databases.

SET @confirm_manual_account_reset := 'NO';
SET @confirm_reset_all_accounts := 'NO';

START TRANSACTION;

SET @safety_sql := IF(
  @confirm_manual_account_reset = 'YES' AND @confirm_reset_all_accounts = 'YES',
  'SELECT ''manual all-organizer reset confirmed'' AS status',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Manual all-organizer reset blocked: set @confirm_manual_account_reset and @confirm_reset_all_accounts to YES.'''
);
PREPARE stmt FROM @safety_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TEMPORARY TABLE IF EXISTS manual_reset_organizer_accounts;
CREATE TEMPORARY TABLE manual_reset_organizer_accounts DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci AS
SELECT CONVERT(ora.id USING utf8mb4) COLLATE utf8mb4_general_ci AS id,
       LOWER(CONVERT(ora.email USING utf8mb4)) COLLATE utf8mb4_general_ci AS email,
       CONVERT(ora.auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci AS auth_user_id,
       CONVERT(ora.role_assignment_id USING utf8mb4) COLLATE utf8mb4_general_ci AS role_assignment_id
FROM organizer_role_accounts ora;

DROP TEMPORARY TABLE IF EXISTS manual_reset_tournaments;
CREATE TEMPORARY TABLE manual_reset_tournaments DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci AS
SELECT DISTINCT CONVERT(t.id USING utf8mb4) COLLATE utf8mb4_general_ci AS id
FROM tournaments t
JOIN manual_reset_organizer_accounts target_organizer
  ON target_organizer.id = CONVERT(t.organizer_account_id USING utf8mb4) COLLATE utf8mb4_general_ci
  OR target_organizer.email = LOWER(CONVERT(t.organizer_email USING utf8mb4)) COLLATE utf8mb4_general_ci
  OR target_organizer.auth_user_id = CONVERT(t.created_by_auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci;

DELETE ttsa FROM tournament_team_start_assignments ttsa JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(ttsa.tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE tts FROM tournament_team_scores tts JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(tts.tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE tr FROM tournament_registrations tr JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(tr.tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE gct FROM golf_course_tournaments gct JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(gct.golfhomiez_tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE oti FROM organizer_tournament_invites oti LEFT JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(oti.tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci LEFT JOIN manual_reset_organizer_accounts target_organizer ON target_organizer.id = CONVERT(oti.organizer_account_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_organizer.email = LOWER(CONVERT(oti.organizer_email USING utf8mb4)) COLLATE utf8mb4_general_ci WHERE target_tournament.id IS NOT NULL OR target_organizer.id IS NOT NULL;
DELETE os FROM organizer_sessions os JOIN manual_reset_organizer_accounts target_organizer ON target_organizer.id = CONVERT(os.organizer_account_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE oprt FROM organizer_password_reset_tokens oprt JOIN manual_reset_organizer_accounts target_organizer ON target_organizer.id = CONVERT(oprt.organizer_account_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE t FROM tournaments t JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(t.id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE ora FROM organizer_role_accounts ora JOIN manual_reset_organizer_accounts target_organizer ON target_organizer.id = CONVERT(ora.id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE ura FROM user_role_assignments ura JOIN manual_reset_organizer_accounts target_organizer ON target_organizer.role_assignment_id = CONVERT(ura.id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_organizer.auth_user_id = CONVERT(ura.auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_organizer.email = LOWER(CONVERT(ura.email USING utf8mb4)) COLLATE utf8mb4_general_ci WHERE LOWER(CONVERT(ura.role_key USING utf8mb4)) COLLATE utf8mb4_general_ci = 'organizer';

COMMIT;

SELECT 'all organizer accounts reset completed' AS status,
  (SELECT COUNT(*) FROM manual_reset_organizer_accounts) AS targeted_organizer_accounts,
  (SELECT COUNT(*) FROM manual_reset_tournaments) AS targeted_tournaments;
