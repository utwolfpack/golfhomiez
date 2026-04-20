DELETE tm1 FROM team_members tm1
JOIN team_members tm2
  ON tm1.team_id = tm2.team_id
 AND tm1.user_id = tm2.user_id
 AND tm1.created_at > tm2.created_at;

ALTER TABLE team_members DROP PRIMARY KEY;

ALTER TABLE team_members
ADD PRIMARY KEY (team_id, user_id);