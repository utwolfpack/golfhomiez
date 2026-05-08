-- Remove the redundant template_data.tournamentName JSON value so the
-- canonical tournaments.name field is the only tournament-name source.
UPDATE tournaments
   SET template_data = JSON_REMOVE(template_data, '$.tournamentName')
 WHERE template_data IS NOT NULL
   AND JSON_VALID(template_data)
   AND JSON_CONTAINS_PATH(template_data, 'one', '$.tournamentName');
