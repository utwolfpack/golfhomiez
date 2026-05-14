-- Retire host-account invite data/schema after the account-request approval workflow replaced manual host invites.
-- This is intentionally destructive for the retired feature. Back up production before running migrations.
DROP TABLE IF EXISTS host_account_invites;

-- Keep legacy host_accounts.invite_id nullable so historical host accounts continue to load without
-- requiring an invite table or foreign-key relationship.
ALTER TABLE host_accounts MODIFY COLUMN invite_id VARCHAR(191) NULL;
