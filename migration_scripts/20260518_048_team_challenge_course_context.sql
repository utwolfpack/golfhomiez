ALTER TABLE inbox_messages ADD COLUMN challenge_date DATE NULL AFTER challenge_status;
ALTER TABLE inbox_messages ADD COLUMN challenge_state VARCHAR(64) NULL AFTER challenge_date;
ALTER TABLE inbox_messages ADD COLUMN challenge_course VARCHAR(255) NULL AFTER challenge_state;

CREATE INDEX idx_inbox_messages_team_challenge_course_context ON inbox_messages(message_type, challenge_date, challenge_state, challenge_course);
