CREATE TABLE IF NOT EXISTS golf_courses (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  normalized_name VARCHAR(191) NOT NULL,
  country CHAR(2) NOT NULL DEFAULT 'US',
  state CHAR(2) NOT NULL,
  city VARCHAR(191) NULL,
  course_type VARCHAR(64) NULL,
  holes_count TINYINT NULL,
  par_total SMALLINT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  phone VARCHAR(64) NULL,
  website VARCHAR(255) NULL,
  year_built SMALLINT NULL,
  address VARCHAR(255) NULL,
  postal_code VARCHAR(20) NULL,
  architect VARCHAR(255) NULL,
  total_yardage INT NULL,
  osm_id BIGINT NULL,
  source_updated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_golf_courses_state_name_city (state, normalized_name, city),
  KEY idx_golf_courses_state_name (state, normalized_name),
  KEY idx_golf_courses_name (normalized_name),
  KEY idx_golf_courses_state_city (state, city),
  KEY idx_golf_courses_coordinates (latitude, longitude)
);

CREATE TABLE IF NOT EXISTS golf_course_holes (
  golf_course_id VARCHAR(36) NOT NULL,
  hole_number TINYINT NOT NULL,
  par_value TINYINT NULL,
  handicap_value TINYINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (golf_course_id, hole_number),
  CONSTRAINT fk_golf_course_holes_course FOREIGN KEY (golf_course_id) REFERENCES golf_courses(id) ON DELETE CASCADE,
  KEY idx_golf_course_holes_number (hole_number)
);

ALTER TABLE scores
  ADD COLUMN golf_course_id VARCHAR(36) NULL,
  ADD COLUMN course_rating DECIMAL(5,1) NULL,
  ADD COLUMN slope_rating SMALLINT NULL,
  ADD COLUMN course_par SMALLINT NULL;

CREATE INDEX idx_scores_golf_course_id ON scores(golf_course_id);
