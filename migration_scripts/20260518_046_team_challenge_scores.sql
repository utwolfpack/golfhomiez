ALTER TABLE inbox_messages ADD COLUMN proposer_team_score INT NULL AFTER challenge_status;
ALTER TABLE inbox_messages ADD COLUMN challenged_team_score INT NULL AFTER proposer_team_score;

CREATE INDEX idx_inbox_messages_team_challenge_scores ON inbox_messages(message_type, proposer_team_id, challenged_team_id, challenge_status);
