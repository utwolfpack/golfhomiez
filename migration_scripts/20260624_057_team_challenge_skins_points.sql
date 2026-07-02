-- Adds persisted scoring settings for Team Challenge skins and Skins - Push point tracking.
-- The migration runner checks for existing columns and indexes before applying these statements.

ALTER TABLE inbox_messages
  ADD COLUMN challenge_scoring_type VARCHAR(32) NOT NULL DEFAULT 'stroke_play' AFTER challenge_tee_color;

ALTER TABLE inbox_messages
  ADD COLUMN challenge_points_per_hole DECIMAL(10,2) NULL AFTER challenge_scoring_type;

UPDATE inbox_messages
   SET challenge_scoring_type = 'stroke_play'
 WHERE challenge_scoring_type IS NULL OR TRIM(challenge_scoring_type) = '';

CREATE INDEX idx_inbox_messages_team_challenge_scoring
  ON inbox_messages(message_type, challenge_scoring_type, challenge_status, created_at);
