ALTER TABLE scores
  ADD COLUMN golf_course_id VARCHAR(191) NULL AFTER course,
  ADD COLUMN course_rating DECIMAL(4,1) NULL AFTER golf_course_id,
  ADD COLUMN slope_rating INT NULL AFTER course_rating,
  ADD COLUMN course_par INT NULL AFTER slope_rating;

ALTER TABLE scores
  ADD INDEX idx_scores_golf_course_id (golf_course_id);
