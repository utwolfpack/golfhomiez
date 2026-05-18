ALTER TABLE inbox_messages ADD COLUMN proposer_team_holes_json JSON NULL AFTER proposer_team_score;
ALTER TABLE inbox_messages ADD COLUMN challenged_team_holes_json JSON NULL AFTER challenged_team_score;

CREATE INDEX idx_inbox_messages_team_challenge_hole_scorecards ON inbox_messages(message_type, thread_id, proposer_team_id, challenged_team_id);
