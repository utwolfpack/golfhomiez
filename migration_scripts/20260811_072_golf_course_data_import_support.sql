-- Support the getGolfCourseData scheduled job without overwriting the raw
-- /courses/{id} payload when /holes and /tees are refreshed.
--
-- Fresh environments receive golf_courses and golf_course_holes from migration 059.
-- Migration 060 adds tee_latitude / tee_longitude. This migration adds separate
-- raw endpoint payload columns so each OpenGolfAPI source can be diagnosed later.

ALTER TABLE golf_courses
  ADD COLUMN raw_holes_payload JSON NULL AFTER raw_detail_payload,
  ADD COLUMN raw_tees_payload JSON NULL AFTER raw_holes_payload;
