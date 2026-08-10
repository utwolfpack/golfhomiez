-- Adds soft-archive support for tournaments managed by hosts and organizers.
-- Archived tournaments remain in the database and can be restored later.
ALTER TABLE tournaments
  ADD COLUMN archived_at DATETIME NULL AFTER status;

CREATE INDEX idx_tournaments_archived_at
  ON tournaments (archived_at);
