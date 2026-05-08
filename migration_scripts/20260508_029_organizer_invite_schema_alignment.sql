ALTER TABLE organizer_role_accounts ADD COLUMN role_assignment_id VARCHAR(64) NULL AFTER id;
CREATE INDEX idx_organizer_role_accounts_role_assignment ON organizer_role_accounts (role_assignment_id);
