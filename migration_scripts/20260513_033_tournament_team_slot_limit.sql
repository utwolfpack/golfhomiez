-- Add tournament team slot capacity with a safe default for existing tournaments.
ALTER TABLE tournaments
  ADD COLUMN team_slot_limit INT NOT NULL DEFAULT 24;

UPDATE tournaments
   SET team_slot_limit = 24
 WHERE team_slot_limit IS NULL OR team_slot_limit <= 0;
