ALTER TABLE inbox_messages MODIFY message_type ENUM('message','challenge_request','individual_challenge') NOT NULL DEFAULT 'message';
ALTER TABLE inbox_messages ADD COLUMN individual_participants_json JSON NULL AFTER challenged_team_holes_json;
CREATE INDEX idx_inbox_messages_individual_challenge_participants ON inbox_messages(message_type, thread_id, created_at);
