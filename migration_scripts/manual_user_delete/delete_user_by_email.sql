-- Manual user deletion script for GolfHomiez.
-- Purpose: delete one target user and related records by email.
-- This manual-only script is intentionally NOT run by npm install, postinstall, or the automatic migration runner.
-- Preferred execution path: npm run data:delete-user -- --email target@example.com --dry-run
--                         npm run data:delete-user -- --email target@example.com --confirm
--
-- Direct MySQL execution:
--   1. Set @target_user_email to the user email.
--   2. Leave @confirm_delete_user = 'NO' to review/edit safely.
--   3. Change @confirm_delete_user to 'YES' immediately before execution.
--
-- Collation note: work tables use utf8mb4_general_ci and comparisons normalize both sides.

SET @target_user_email := 'replace-with-target-user@example.com';
SET @confirm_delete_user := 'NO';

SET @normalized_target_user_email := LOWER(CONVERT(TRIM(@target_user_email) USING utf8mb4)) COLLATE utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS manual_delete_target_email (
  email VARCHAR(512) NOT NULL PRIMARY KEY
) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS manual_delete_auth_users (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NULL,
  KEY idx_email (email)
) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS manual_delete_host_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NULL,
  auth_user_id VARCHAR(191) NULL,
  invite_id VARCHAR(191) NULL,
  KEY idx_email (email),
  KEY idx_auth_user (auth_user_id),
  KEY idx_invite (invite_id)
) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS manual_delete_host_role_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NULL,
  auth_user_id VARCHAR(191) NULL,
  role_assignment_id VARCHAR(191) NULL,
  KEY idx_email (email),
  KEY idx_auth_user (auth_user_id),
  KEY idx_assignment (role_assignment_id)
) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS manual_delete_organizer_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NULL,
  auth_user_id VARCHAR(191) NULL,
  role_assignment_id VARCHAR(191) NULL,
  KEY idx_email (email),
  KEY idx_auth_user (auth_user_id),
  KEY idx_assignment (role_assignment_id)
) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS manual_delete_role_assignments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  role_key VARCHAR(64) NULL,
  KEY idx_email (email),
  KEY idx_auth_user (auth_user_id),
  KEY idx_role (role_key)
) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS manual_delete_tournaments (
  id VARCHAR(191) NOT NULL PRIMARY KEY
) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS manual_delete_teams (
  id VARCHAR(191) NOT NULL PRIMARY KEY
) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

TRUNCATE TABLE manual_delete_target_email;
TRUNCATE TABLE manual_delete_auth_users;
TRUNCATE TABLE manual_delete_host_accounts;
TRUNCATE TABLE manual_delete_host_role_accounts;
TRUNCATE TABLE manual_delete_organizer_accounts;
TRUNCATE TABLE manual_delete_role_assignments;
TRUNCATE TABLE manual_delete_tournaments;
TRUNCATE TABLE manual_delete_teams;

INSERT INTO manual_delete_target_email (email) VALUES (@normalized_target_user_email);

INSERT IGNORE INTO manual_delete_auth_users (id, email)
SELECT u.id, u.email
  FROM `user` u
 WHERE LOWER(CONVERT(u.email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email;

INSERT IGNORE INTO manual_delete_auth_users (id, email)
SELECT au.auth_user_id, au.email
  FROM app_users au
 WHERE LOWER(CONVERT(au.email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email;

INSERT IGNORE INTO manual_delete_role_assignments (id, auth_user_id, email, role_key)
SELECT ura.id, ura.auth_user_id, ura.email, ura.role_key
  FROM user_role_assignments ura
 WHERE CONVERT(ura.auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_general_ci FROM manual_delete_auth_users)
    OR LOWER(CONVERT(ura.email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email;

INSERT IGNORE INTO manual_delete_host_accounts (id, email, auth_user_id, invite_id)
SELECT ha.id, ha.email, ha.auth_user_id, ha.invite_id
  FROM host_accounts ha
 WHERE LOWER(CONVERT(ha.email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email
    OR LOWER(CONVERT(ha.reset_email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email
    OR CONVERT(ha.auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_general_ci FROM manual_delete_auth_users);

INSERT IGNORE INTO manual_delete_host_role_accounts (id, email, auth_user_id, role_assignment_id)
SELECT hra.id, hra.email, hra.auth_user_id, hra.role_assignment_id
  FROM host_role_accounts hra
 WHERE LOWER(CONVERT(hra.email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email
    OR CONVERT(hra.auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_general_ci FROM manual_delete_auth_users)
    OR CONVERT(hra.role_assignment_id USING utf8mb4) COLLATE utf8mb4_general_ci IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_general_ci FROM manual_delete_role_assignments);

INSERT IGNORE INTO manual_delete_organizer_accounts (id, email, auth_user_id, role_assignment_id)
SELECT ora.id, ora.email, ora.auth_user_id, ora.role_assignment_id
  FROM organizer_role_accounts ora
 WHERE LOWER(CONVERT(ora.email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email
    OR LOWER(CONVERT(ora.reset_email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email
    OR CONVERT(ora.auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_general_ci FROM manual_delete_auth_users)
    OR CONVERT(ora.role_assignment_id USING utf8mb4) COLLATE utf8mb4_general_ci IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_general_ci FROM manual_delete_role_assignments);

INSERT IGNORE INTO manual_delete_tournaments (id)
SELECT DISTINCT t.id
  FROM tournaments t
  LEFT JOIN manual_delete_host_accounts ha ON CONVERT(t.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(ha.id USING utf8mb4) COLLATE utf8mb4_general_ci
  LEFT JOIN manual_delete_host_role_accounts hra ON CONVERT(t.host_account_id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(hra.id USING utf8mb4) COLLATE utf8mb4_general_ci
  LEFT JOIN manual_delete_organizer_accounts ora ON CONVERT(t.organizer_account_id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(ora.id USING utf8mb4) COLLATE utf8mb4_general_ci
  LEFT JOIN manual_delete_auth_users au ON CONVERT(t.created_by_auth_user_id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(au.id USING utf8mb4) COLLATE utf8mb4_general_ci
 WHERE ha.id IS NOT NULL
    OR hra.id IS NOT NULL
    OR ora.id IS NOT NULL
    OR au.id IS NOT NULL
    OR LOWER(CONVERT(t.organizer_email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email;

INSERT IGNORE INTO manual_delete_teams (id)
SELECT DISTINCT tm.team_id
  FROM team_members tm
 WHERE LOWER(CONVERT(tm.email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email
    OR CONVERT(tm.id USING utf8mb4) COLLATE utf8mb4_general_ci IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_general_ci FROM manual_delete_auth_users);

SELECT 'matched_auth_users' AS item, COUNT(*) AS matched_count FROM manual_delete_auth_users
UNION ALL SELECT 'matched_host_accounts', COUNT(*) FROM manual_delete_host_accounts
UNION ALL SELECT 'matched_host_role_accounts', COUNT(*) FROM manual_delete_host_role_accounts
UNION ALL SELECT 'matched_organizer_accounts', COUNT(*) FROM manual_delete_organizer_accounts
UNION ALL SELECT 'matched_role_assignments', COUNT(*) FROM manual_delete_role_assignments
UNION ALL SELECT 'matched_tournaments', COUNT(*) FROM manual_delete_tournaments
UNION ALL SELECT 'matched_teams', COUNT(*) FROM manual_delete_teams;

START TRANSACTION;

SET @safety_check := CASE WHEN @confirm_delete_user = 'YES' THEN 1 ELSE 0 END;

DELETE FROM tournament_team_start_assignments WHERE tournament_id IN (SELECT id FROM manual_delete_tournaments) AND @safety_check = 1;
DELETE FROM tournament_team_scores WHERE tournament_id IN (SELECT id FROM manual_delete_tournaments) AND @safety_check = 1;
DELETE FROM tournament_registrations WHERE tournament_id IN (SELECT id FROM manual_delete_tournaments) AND @safety_check = 1;
DELETE FROM organizer_tournament_invites WHERE tournament_id IN (SELECT id FROM manual_delete_tournaments) AND @safety_check = 1;
DELETE FROM golf_course_tournaments WHERE golfhomiez_tournament_id IN (SELECT id FROM manual_delete_tournaments) AND @safety_check = 1;
DELETE FROM tournaments WHERE id IN (SELECT id FROM manual_delete_tournaments) AND @safety_check = 1;
DELETE FROM host_sessions WHERE host_account_id IN (SELECT id FROM manual_delete_host_accounts) AND @safety_check = 1;
DELETE FROM host_password_reset_tokens WHERE host_account_id IN (SELECT id FROM manual_delete_host_accounts) AND @safety_check = 1;
DELETE FROM organizer_sessions WHERE organizer_account_id IN (SELECT id FROM manual_delete_organizer_accounts) AND @safety_check = 1;
DELETE FROM organizer_password_reset_tokens WHERE organizer_account_id IN (SELECT id FROM manual_delete_organizer_accounts) AND @safety_check = 1;
DELETE FROM scorecard_hole_drafts WHERE @safety_check = 1 AND (created_by_user_id IN (SELECT id FROM manual_delete_auth_users) OR LOWER(CONVERT(created_by_email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email);
DELETE FROM scores WHERE @safety_check = 1 AND (created_by_user_id IN (SELECT id FROM manual_delete_auth_users) OR LOWER(CONVERT(created_by_email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email);
DELETE FROM inbox_challenge_user_state WHERE @safety_check = 1 AND (user_key IN (SELECT id FROM manual_delete_auth_users) OR LOWER(CONVERT(user_key USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email);
DELETE FROM inbox_messages WHERE @safety_check = 1 AND (sender_user_id IN (SELECT id FROM manual_delete_auth_users) OR recipient_user_id IN (SELECT id FROM manual_delete_auth_users) OR LOWER(CONVERT(sender_email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email OR LOWER(CONVERT(recipient_email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email);
DELETE FROM team_members WHERE @safety_check = 1 AND (team_id IN (SELECT id FROM manual_delete_teams) OR LOWER(CONVERT(email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email);
DELETE FROM teams WHERE id IN (SELECT id FROM manual_delete_teams) AND @safety_check = 1;
DELETE FROM app_users WHERE @safety_check = 1 AND (auth_user_id IN (SELECT id FROM manual_delete_auth_users) OR LOWER(CONVERT(email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email);
DELETE FROM user_role_assignments WHERE id IN (SELECT id FROM manual_delete_role_assignments) AND @safety_check = 1;
DELETE FROM host_accounts WHERE id IN (SELECT id FROM manual_delete_host_accounts) AND @safety_check = 1;
DELETE FROM host_role_accounts WHERE id IN (SELECT id FROM manual_delete_host_role_accounts) AND @safety_check = 1;
DELETE FROM organizer_role_accounts WHERE id IN (SELECT id FROM manual_delete_organizer_accounts) AND @safety_check = 1;
DELETE FROM session WHERE userId IN (SELECT id FROM manual_delete_auth_users) AND @safety_check = 1;
DELETE FROM account WHERE userId IN (SELECT id FROM manual_delete_auth_users) AND @safety_check = 1;
DELETE FROM verification WHERE identifier = @normalized_target_user_email AND @safety_check = 1;
DELETE FROM email_verification_tokens WHERE @safety_check = 1 AND (user_id IN (SELECT id FROM manual_delete_auth_users) OR LOWER(CONVERT(email USING utf8mb4)) COLLATE utf8mb4_general_ci = @normalized_target_user_email);
DELETE FROM `user` WHERE id IN (SELECT id FROM manual_delete_auth_users) AND @safety_check = 1;

COMMIT;

DROP TABLE IF EXISTS manual_delete_teams;
DROP TABLE IF EXISTS manual_delete_tournaments;
DROP TABLE IF EXISTS manual_delete_role_assignments;
DROP TABLE IF EXISTS manual_delete_organizer_accounts;
DROP TABLE IF EXISTS manual_delete_host_role_accounts;
DROP TABLE IF EXISTS manual_delete_host_accounts;
DROP TABLE IF EXISTS manual_delete_auth_users;
DROP TABLE IF EXISTS manual_delete_target_email;

SELECT CASE WHEN @confirm_delete_user = 'YES' THEN 'User delete committed.' ELSE 'Safety check prevented deletes. Set @confirm_delete_user to YES to execute.' END AS manual_delete_status;
