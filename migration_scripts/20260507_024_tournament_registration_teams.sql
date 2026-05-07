-- Adds team metadata to tournament registrations so public/host/organizer tournament areas
-- can show which teams signed up and who belongs to each team.
ALTER TABLE tournament_registrations
  ADD COLUMN team_id VARCHAR(191) NULL AFTER status,
  ADD COLUMN team_name VARCHAR(191) NULL AFTER team_id,
  ADD COLUMN team_members_json JSON NULL AFTER team_name;

CREATE INDEX idx_tournament_registrations_team ON tournament_registrations (team_id);
