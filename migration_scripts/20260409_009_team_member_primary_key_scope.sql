ALTER TABLE team_members DROP PRIMARY KEY;
ALTER TABLE team_members ADD PRIMARY KEY (team_id, id);
CREATE INDEX idx_team_members_member_id ON team_members(id);
