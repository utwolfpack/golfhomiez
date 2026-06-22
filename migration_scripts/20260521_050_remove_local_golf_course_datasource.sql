-- Removes the local golf-course catalog and hole-scorecard datasource.
-- Course search, course metadata, and hole metadata are now loaded from the Golfbert API.
-- Applied automatically by npm install via npm run db:migrate.
-- Drop child tables first so MySQL foreign keys do not block the golf_courses drop.

DROP TABLE IF EXISTS golf_course_hole_scorecards;
DROP TABLE IF EXISTS golf_course_holes;
DROP TABLE IF EXISTS golf_courses;
