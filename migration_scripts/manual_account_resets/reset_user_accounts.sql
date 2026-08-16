-- Manual data reset script: all golfer user accounts.
-- Purpose: create a clean data environment by deleting all golfer user accounts and user-owned records.
-- This script is intentionally NOT registered in server/migrations/index.js and is NOT run by npm install.
-- Usage: set both confirmation variables to YES, review in a non-production clone first, then execute manually.

SET @confirm_manual_account_reset := 'NO';
SET @confirm_reset_all_accounts := 'NO';

START TRANSACTION;

SET @safety_sql := IF(
  @confirm_manual_account_reset = 'YES' AND @confirm_reset_all_accounts = 'YES',
  'SELECT ''manual all-user reset confirmed'' AS status',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Manual all-user reset blocked: set @confirm_manual_account_reset and @confirm_reset_all_accounts to YES.'''
);
PREPARE stmt FROM @safety_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TEMPORARY TABLE IF EXISTS manual_reset_auth_users;
CREATE TEMPORARY TABLE manual_reset_auth_users (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NULL,
  KEY idx_manual_reset_auth_users_email (email)
) ENGINE=Memory;

INSERT IGNORE INTO manual_reset_auth_users (id, email)
SELECT id, email
FROM `user`;

INSERT IGNORE INTO manual_reset_auth_users (id, email)
SELECT auth_user_id, email
FROM app_users
WHERE auth_user_id IS NOT NULL;

DROP TEMPORARY TABLE IF EXISTS manual_reset_teams;
CREATE TEMPORARY TABLE manual_reset_teams AS
SELECT DISTINCT tm.team_id AS id
FROM team_members tm
JOIN manual_reset_auth_users target_user
  ON target_user.id = tm.id
  OR LOWER(target_user.email) = LOWER(tm.email);

DELETE s FROM `session` s JOIN manual_reset_auth_users target_user ON target_user.id = s.userId;
DELETE a FROM account a JOIN manual_reset_auth_users target_user ON target_user.id = a.userId;
DELETE v FROM verification v JOIN manual_reset_auth_users target_user ON LOWER(target_user.email) = LOWER(v.identifier);
DELETE evt FROM email_verification_tokens evt JOIN manual_reset_auth_users target_user ON target_user.id = evt.user_id OR LOWER(target_user.email) = LOWER(evt.email);
DELETE draft FROM scorecard_hole_drafts draft JOIN manual_reset_auth_users target_user ON target_user.id = draft.created_by_user_id OR LOWER(target_user.email) = LOWER(draft.created_by_email);
DELETE score FROM scores score JOIN manual_reset_auth_users target_user ON target_user.id = score.created_by_user_id OR LOWER(target_user.email) = LOWER(score.created_by_email);
DELETE tr FROM tournament_registrations tr JOIN manual_reset_auth_users target_user ON target_user.id = tr.auth_user_id OR LOWER(target_user.email) = LOWER(tr.email);
DELETE state FROM inbox_challenge_user_state state JOIN manual_reset_auth_users target_user ON state.user_key = target_user.id OR LOWER(state.user_key) = LOWER(target_user.email) OR LOWER(state.user_key) = LOWER(CONCAT(target_user.id, '|', target_user.email));
DELETE im FROM inbox_messages im JOIN manual_reset_auth_users target_user ON target_user.id = im.sender_user_id OR target_user.id = im.recipient_user_id OR LOWER(target_user.email) = LOWER(im.sender_email) OR LOWER(target_user.email) = LOWER(im.recipient_email);
DELETE tm FROM team_members tm JOIN manual_reset_auth_users target_user ON target_user.id = tm.id OR LOWER(target_user.email) = LOWER(tm.email);
DELETE t FROM teams t JOIN manual_reset_teams target_team ON target_team.id = t.id LEFT JOIN team_members tm ON tm.team_id = t.id WHERE tm.team_id IS NULL;
DELETE au FROM app_users au JOIN manual_reset_auth_users target_user ON target_user.id = au.auth_user_id OR LOWER(target_user.email) = LOWER(au.email);
DELETE ura FROM user_role_assignments ura JOIN manual_reset_auth_users target_user ON target_user.id = ura.auth_user_id OR LOWER(target_user.email) = LOWER(ura.email);
DELETE u FROM `user` u JOIN manual_reset_auth_users target_user ON target_user.id = u.id;

COMMIT;

SELECT 'all golfer user accounts reset completed' AS status, COUNT(*) AS targeted_accounts
FROM manual_reset_auth_users;
