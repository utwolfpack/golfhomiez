-- Adds a future-ready source table for course hole metadata used by the scorecard entry flow.
-- Applied automatically by npm install via npm run db:migrate.

CREATE TABLE IF NOT EXISTS golf_course_hole_scorecards (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  golf_course_id VARCHAR(191) NULL,
  state VARCHAR(8) NOT NULL,
  course_name VARCHAR(191) NOT NULL,
  hole_number TINYINT UNSIGNED NOT NULL,
  par TINYINT UNSIGNED NULL,
  yards SMALLINT UNSIGNED NULL,
  stroke_index TINYINT UNSIGNED NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'api',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_golf_course_hole_scorecards_course_hole (state, course_name, hole_number),
  INDEX idx_golf_course_hole_scorecards_course_id (golf_course_id),
  INDEX idx_golf_course_hole_scorecards_state_course (state, course_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
