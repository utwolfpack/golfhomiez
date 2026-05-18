ALTER TABLE scorecard_hole_drafts
  ADD COLUMN scoring_side VARCHAR(16) NOT NULL DEFAULT 'team' AFTER mode;

ALTER TABLE scorecard_hole_drafts
  DROP INDEX idx_scorecard_hole_drafts_context_lookup;

CREATE INDEX idx_scorecard_hole_drafts_context_lookup
  ON scorecard_hole_drafts (created_by_user_id, mode, scoring_side, date, state, course(160), team_key(160), opponent_team_key(160));

ALTER TABLE scores
  ADD COLUMN opponent_holes_json JSON NULL AFTER holes_json;
