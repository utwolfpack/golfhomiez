-- Remove records created exclusively by the retired homepage demo-statistics experience.
-- The predicates intentionally target only the historical homepage demo identity/team.
DELETE FROM scores
WHERE LOWER(created_by_email) = 'thegolfhomie@example.com';

DELETE tm
FROM team_members tm
INNER JOIN teams t ON t.id = tm.team_id
WHERE LOWER(tm.email) = 'thegolfhomie@example.com'
  AND t.name = 'Homie Hustlers';

DELETE FROM teams
WHERE name = 'Homie Hustlers'
  AND NOT EXISTS (
    SELECT 1
    FROM team_members tm
    WHERE tm.team_id = teams.id
  );

DELETE FROM `user`
WHERE LOWER(email) = 'thegolfhomie@example.com';
