-- Recreates the golf-course catalog as a database-backed OpenGolfAPI import target.
-- OpenGolfAPI state list curl format. The endpoint is paginated, so import scripts must
-- walk limit/offset pages for each state instead of trusting the default 50-row response:
--   curl "https://api.opengolfapi.org/v1/courses/state/UT?limit=50&offset=0"
--   curl "https://api.opengolfapi.org/v1/courses/state/UT?limit=50&offset=50"
-- OpenGolfAPI course detail curl format used by the importer for hole data:
--   curl "https://api.opengolfapi.org/v1/courses/{id}"
-- Manual records can use source='manual' and is_manual=1 with the same user-friendly columns.

CREATE TABLE IF NOT EXISTS golf_courses (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  external_course_id VARCHAR(128) NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  name VARCHAR(191) NOT NULL,
  normalized_name VARCHAR(191) NOT NULL,
  state_code VARCHAR(8) NOT NULL,
  state_name VARCHAR(64) NULL,
  county VARCHAR(128) NULL,
  city VARCHAR(128) NULL,
  country VARCHAR(8) NOT NULL DEFAULT 'US',
  course_type VARCHAR(64) NULL,
  holes_count TINYINT UNSIGNED NULL,
  par_total SMALLINT UNSIGNED NULL,
  total_yardage SMALLINT UNSIGNED NULL,
  course_rating DECIMAL(4,1) NULL,
  slope_rating SMALLINT UNSIGNED NULL,
  address VARCHAR(255) NULL,
  postal_code VARCHAR(32) NULL,
  phone VARCHAR(64) NULL,
  website VARCHAR(255) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  is_manual TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  raw_list_payload JSON NULL,
  raw_detail_payload JSON NULL,
  imported_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_golf_courses_source_external_id (source, external_course_id),
  KEY idx_golf_courses_state_name (state_code, normalized_name),
  KEY idx_golf_courses_state_city (state_code, city),
  KEY idx_golf_courses_active_state (active, state_code, name),
  KEY idx_golf_courses_coordinates (latitude, longitude)
);

CREATE TABLE IF NOT EXISTS golf_course_holes (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  course_id VARCHAR(64) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  hole_number TINYINT UNSIGNED NOT NULL,
  tee_name VARCHAR(64) NOT NULL DEFAULT 'default',
  tee_color VARCHAR(32) NOT NULL DEFAULT 'default',
  par TINYINT UNSIGNED NULL,
  yards SMALLINT UNSIGNED NULL,
  stroke_index TINYINT UNSIGNED NULL,
  front_latitude DECIMAL(10,7) NULL,
  front_longitude DECIMAL(10,7) NULL,
  center_latitude DECIMAL(10,7) NULL,
  center_longitude DECIMAL(10,7) NULL,
  back_latitude DECIMAL(10,7) NULL,
  back_longitude DECIMAL(10,7) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  raw_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_golf_course_holes_course_hole_tee_source (course_id, hole_number, tee_name, source),
  KEY idx_golf_course_holes_course_hole (course_id, hole_number),
  KEY idx_golf_course_holes_course_tee (course_id, tee_color),
  CONSTRAINT fk_golf_course_holes_course FOREIGN KEY (course_id) REFERENCES golf_courses(id) ON DELETE CASCADE
);
