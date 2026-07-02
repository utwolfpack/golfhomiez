-- Drops legacy transient golf-course catalog tables before recreating the database-backed catalog.
-- Score rows keep external course identifiers in scores.golf_course_id.

DROP TABLE IF EXISTS golf_course_hole_scorecards;
DROP TABLE IF EXISTS golf_course_holes;
DROP TABLE IF EXISTS golf_courses;
