ALTER TABLE teams
  ADD COLUMN team_identifier BIGINT UNSIGNED NULL AFTER name;

SET @next_team_identifier := GREATEST(
  99,
  COALESCE((SELECT MAX(team_identifier) FROM teams), 99)
);

UPDATE teams
   SET team_identifier = (@next_team_identifier := @next_team_identifier + 1)
 WHERE team_identifier IS NULL
 ORDER BY created_at ASC, id ASC;

ALTER TABLE teams
  MODIFY COLUMN team_identifier BIGINT UNSIGNED NOT NULL;

CREATE UNIQUE INDEX idx_teams_team_identifier
  ON teams (team_identifier);

ALTER TABLE teams
  MODIFY COLUMN team_identifier BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE teams AUTO_INCREMENT = 100;
