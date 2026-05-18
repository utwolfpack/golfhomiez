-- Adds stroke index metadata for course hole scorecards in environments where
-- 20260516_039 was already applied before stroke index support was added.

ALTER TABLE golf_course_hole_scorecards
  ADD COLUMN stroke_index TINYINT UNSIGNED NULL AFTER yards;
