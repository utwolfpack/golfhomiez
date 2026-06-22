-- Adds tee-color context for saved rounds and golf challenge messages.
-- The migration runner performs column-existence checks before applying this script in normal deployments.

ALTER TABLE scores
  ADD COLUMN tee_color VARCHAR(16) NOT NULL DEFAULT 'white' AFTER round_score;

ALTER TABLE inbox_messages
  ADD COLUMN challenge_tee_color VARCHAR(16) NOT NULL DEFAULT 'white' AFTER challenge_course;
