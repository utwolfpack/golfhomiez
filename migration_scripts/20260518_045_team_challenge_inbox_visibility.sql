ALTER TABLE inbox_messages ADD COLUMN proposer_team_id VARCHAR(191) NULL AFTER parent_message_id;
ALTER TABLE inbox_messages ADD COLUMN proposer_team_name VARCHAR(255) NULL AFTER proposer_team_id;
ALTER TABLE inbox_messages ADD COLUMN challenged_team_id VARCHAR(191) NULL AFTER proposer_team_name;
ALTER TABLE inbox_messages ADD COLUMN challenged_team_name VARCHAR(255) NULL AFTER challenged_team_id;
ALTER TABLE inbox_messages ADD COLUMN challenge_status VARCHAR(32) NULL AFTER challenged_team_name;

CREATE INDEX idx_inbox_messages_proposer_team_created ON inbox_messages(proposer_team_id, created_at);
CREATE INDEX idx_inbox_messages_challenged_team_read ON inbox_messages(challenged_team_id, read_at, created_at);
CREATE INDEX idx_inbox_messages_challenge_status ON inbox_messages(message_type, challenge_status, created_at);
