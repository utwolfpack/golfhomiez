-- Adds recurrence metadata for golf-course calendar events.
ALTER TABLE golf_course_events
  ADD COLUMN recurrence_cadence VARCHAR(16) NOT NULL DEFAULT 'none' AFTER details,
  ADD COLUMN recurrence_end_date DATE NULL AFTER recurrence_cadence,
  ADD KEY idx_golf_course_events_recurrence (golf_course_public_page_id, recurrence_cadence, recurrence_end_date, event_date);
