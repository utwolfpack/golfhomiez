ALTER TABLE organizer_role_accounts ADD COLUMN contact_name VARCHAR(191) NULL;
ALTER TABLE organizer_role_accounts ADD COLUMN phone VARCHAR(64) NULL;
ALTER TABLE organizer_role_accounts ADD COLUMN website_url VARCHAR(512) NULL;
ALTER TABLE organizer_role_accounts ADD COLUMN notes TEXT NULL;
ALTER TABLE organizer_role_accounts ADD COLUMN password_hash VARCHAR(255) NULL;
ALTER TABLE organizer_role_accounts ADD COLUMN reset_email VARCHAR(191) NULL;
