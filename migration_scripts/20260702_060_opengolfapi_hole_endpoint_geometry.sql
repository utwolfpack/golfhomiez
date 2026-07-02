-- Adds storage needed by the OpenGolfAPI /courses/{id}/holes endpoint backfill.
-- The backfill script uses:
--   curl "https://api.opengolfapi.org/v1/courses/{id}/holes"
--   curl "https://api.opengolfapi.org/v1/courses/{id}/tees"
-- /holes values populate existing golf_course_holes fields:
--   yardages -> yards
--   handicap_index -> stroke_index
--   green.center/front/back -> center/front/back latitude and longitude fields
-- The existing raw_payload JSON column retains the full hole response.
-- tee_coords values require tee_latitude and tee_longitude, which this migration adds.
-- /tees values populate golf_courses.total_yardage, golf_courses.course_rating, and golf_courses.slope_rating.

ALTER TABLE golf_course_holes
  ADD COLUMN tee_latitude DECIMAL(10,7) NULL AFTER stroke_index,
  ADD COLUMN tee_longitude DECIMAL(10,7) NULL AFTER tee_latitude;

CREATE INDEX idx_golf_course_holes_tee_coordinates
  ON golf_course_holes (tee_latitude, tee_longitude);
