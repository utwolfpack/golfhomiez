-- Adds editable host profile fields used by /host/portal/profile.
-- Run through npm install / npm run db:migrate, or apply directly in production.

ALTER TABLE host_accounts ADD COLUMN contact_name VARCHAR(191) NULL;
ALTER TABLE host_accounts ADD COLUMN phone VARCHAR(64) NULL;
ALTER TABLE host_accounts ADD COLUMN website_url VARCHAR(512) NULL;
ALTER TABLE host_accounts ADD COLUMN notes TEXT NULL;
