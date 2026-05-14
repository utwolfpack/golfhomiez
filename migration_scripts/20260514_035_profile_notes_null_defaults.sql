-- Ensures host and organizer portal profile notes are nullable and blank notes are stored as NULL.
-- This script is applied automatically by npm install via npm run db:migrate.

ALTER TABLE host_accounts MODIFY COLUMN notes TEXT NULL;
UPDATE host_accounts SET notes = NULL WHERE notes IS NOT NULL AND TRIM(notes) = '';

ALTER TABLE organizer_role_accounts MODIFY COLUMN notes TEXT NULL;
UPDATE organizer_role_accounts SET notes = NULL WHERE notes IS NOT NULL AND TRIM(notes) = '';
