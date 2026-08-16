-- Manual data reset script: all host accounts.
-- Purpose: create a clean data environment by deleting all host accounts and host-managed tournament/profile data.
-- This script is intentionally NOT registered in server/migrations/index.js and is NOT run by npm install.
-- Usage: set both confirmation variables to YES, review in a non-production clone first, then execute manually.
-- Collation note: comparisons explicitly normalize to utf8mb4_general_ci to avoid mixed-collation failures on upgraded MySQL databases.

SET @confirm_manual_account_reset := 'NO';
SET @confirm_reset_all_accounts := 'NO';

START TRANSACTION;

SET @safety_sql := IF(
  @confirm_manual_account_reset = 'YES' AND @confirm_reset_all_accounts = 'YES',
  'SELECT ''manual all-host reset confirmed'' AS status',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Manual all-host reset blocked: set @confirm_manual_account_reset and @confirm_reset_all_accounts to YES.'''
);
PREPARE stmt FROM @safety_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TEMPORARY TABLE IF EXISTS manual_reset_host_accounts;
CREATE TEMPORARY TABLE manual_reset_host_accounts DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci AS
SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_general_ci AS id,
       LOWER(CONVERT(email USING utf8mb4)) COLLATE utf8mb4_general_ci AS email,
       CONVERT(auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci AS auth_user_id,
       CONVERT(invite_id USING utf8mb4) COLLATE utf8mb4_general_ci AS invite_id
FROM host_accounts;

DROP TEMPORARY TABLE IF EXISTS manual_reset_host_role_accounts;
CREATE TEMPORARY TABLE manual_reset_host_role_accounts DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci AS
SELECT CONVERT(hra.id USING utf8mb4) COLLATE utf8mb4_general_ci AS id,
       LOWER(CONVERT(hra.email USING utf8mb4)) COLLATE utf8mb4_general_ci AS email,
       CONVERT(hra.auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci AS auth_user_id,
       CONVERT(hra.role_assignment_id USING utf8mb4) COLLATE utf8mb4_general_ci AS role_assignment_id
FROM host_role_accounts hra;

DROP TEMPORARY TABLE IF EXISTS manual_reset_tournaments;
CREATE TEMPORARY TABLE manual_reset_tournaments DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci AS
SELECT DISTINCT CONVERT(t.id USING utf8mb4) COLLATE utf8mb4_general_ci AS id
FROM tournaments t
LEFT JOIN manual_reset_host_accounts target_host
  ON target_host.id = CONVERT(t.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci
  OR target_host.auth_user_id = CONVERT(t.created_by_auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci
LEFT JOIN manual_reset_host_role_accounts target_role_host
  ON target_role_host.id = CONVERT(t.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci
  OR target_role_host.auth_user_id = CONVERT(t.created_by_auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE target_host.id IS NOT NULL
   OR target_role_host.id IS NOT NULL;

DELETE ttsa FROM tournament_team_start_assignments ttsa JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(ttsa.tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE tts FROM tournament_team_scores tts JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(tts.tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE tr FROM tournament_registrations tr JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(tr.tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE gct FROM golf_course_tournaments gct JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(gct.golfhomiez_tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE oti FROM organizer_tournament_invites oti LEFT JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(oti.tournament_id USING utf8mb4) COLLATE utf8mb4_general_ci LEFT JOIN manual_reset_host_accounts target_host ON target_host.id = CONVERT(oti.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci LEFT JOIN manual_reset_host_role_accounts target_role_host ON target_role_host.id = CONVERT(oti.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci WHERE target_tournament.id IS NOT NULL OR target_host.id IS NOT NULL OR target_role_host.id IS NOT NULL;
DELETE page FROM golf_course_public_pages page JOIN manual_reset_host_accounts target_host ON target_host.id = CONVERT(page.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE hs FROM host_sessions hs LEFT JOIN manual_reset_host_accounts target_host ON target_host.id = CONVERT(hs.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_host.id = CONVERT(hs.host_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_host.id = CONVERT(hs.account_id USING utf8mb4) COLLATE utf8mb4_general_ci LEFT JOIN manual_reset_host_role_accounts target_role_host ON target_role_host.id = CONVERT(hs.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_role_host.id = CONVERT(hs.host_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_role_host.id = CONVERT(hs.account_id USING utf8mb4) COLLATE utf8mb4_general_ci WHERE target_host.id IS NOT NULL OR target_role_host.id IS NOT NULL;
DELETE hprt FROM host_password_reset_tokens hprt LEFT JOIN manual_reset_host_accounts target_host ON target_host.id = CONVERT(hprt.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_host.id = CONVERT(hprt.host_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_host.email = LOWER(CONVERT(hprt.email USING utf8mb4)) COLLATE utf8mb4_general_ci LEFT JOIN manual_reset_host_role_accounts target_role_host ON target_role_host.id = CONVERT(hprt.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_role_host.id = CONVERT(hprt.host_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_role_host.email = LOWER(CONVERT(hprt.email USING utf8mb4)) COLLATE utf8mb4_general_ci WHERE target_host.id IS NOT NULL OR target_role_host.id IS NOT NULL;
DELETE har FROM host_account_requests har LEFT JOIN manual_reset_host_accounts target_host ON target_host.id = CONVERT(har.approved_host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_host.email = LOWER(CONVERT(har.email USING utf8mb4)) COLLATE utf8mb4_general_ci LEFT JOIN manual_reset_host_role_accounts target_role_host ON target_role_host.id = CONVERT(har.approved_host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_role_host.email = LOWER(CONVERT(har.email USING utf8mb4)) COLLATE utf8mb4_general_ci WHERE target_host.id IS NOT NULL OR target_role_host.id IS NOT NULL;
DELETE hai FROM host_account_invites hai LEFT JOIN manual_reset_host_accounts target_host ON target_host.invite_id = CONVERT(hai.id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_host.email = LOWER(CONVERT(hai.email USING utf8mb4)) COLLATE utf8mb4_general_ci OR target_host.email = LOWER(CONVERT(hai.invitee_email USING utf8mb4)) COLLATE utf8mb4_general_ci LEFT JOIN manual_reset_host_role_accounts target_role_host ON target_role_host.email = LOWER(CONVERT(hai.email USING utf8mb4)) COLLATE utf8mb4_general_ci OR target_role_host.email = LOWER(CONVERT(hai.invitee_email USING utf8mb4)) COLLATE utf8mb4_general_ci WHERE target_host.id IS NOT NULL OR target_role_host.id IS NOT NULL;
DELETE t FROM tournaments t JOIN manual_reset_tournaments target_tournament ON target_tournament.id = CONVERT(t.id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE ha FROM host_accounts ha JOIN manual_reset_host_accounts target_host ON target_host.id = CONVERT(ha.id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE hra FROM host_role_accounts hra JOIN manual_reset_host_role_accounts target_role_host ON target_role_host.id = CONVERT(hra.id USING utf8mb4) COLLATE utf8mb4_general_ci;
DELETE ura FROM user_role_assignments ura LEFT JOIN manual_reset_host_role_accounts target_role_host ON target_role_host.role_assignment_id = CONVERT(ura.id USING utf8mb4) COLLATE utf8mb4_general_ci LEFT JOIN manual_reset_host_accounts target_host ON target_host.auth_user_id = CONVERT(ura.auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci OR target_host.email = LOWER(CONVERT(ura.email USING utf8mb4)) COLLATE utf8mb4_general_ci WHERE LOWER(CONVERT(ura.role_key USING utf8mb4)) COLLATE utf8mb4_general_ci = 'host' AND (target_role_host.id IS NOT NULL OR target_host.id IS NOT NULL);

COMMIT;

SELECT 'all host accounts reset completed' AS status,
  (SELECT COUNT(*) FROM manual_reset_host_accounts) AS targeted_host_accounts,
  (SELECT COUNT(*) FROM manual_reset_host_role_accounts) AS targeted_host_role_accounts,
  (SELECT COUNT(*) FROM manual_reset_tournaments) AS targeted_tournaments;
