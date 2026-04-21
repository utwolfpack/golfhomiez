CREATE TABLE IF NOT EXISTS golf_courses (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  normalized_name VARCHAR(191) NOT NULL,
  country VARCHAR(16) NULL,
  state VARCHAR(64) NOT NULL,
  state_code VARCHAR(8) NOT NULL,
  city VARCHAR(191) NULL,
  course_type VARCHAR(64) NULL,
  holes_count INT NULL,
  par_total INT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  phone VARCHAR(64) NULL,
  website VARCHAR(255) NULL,
  year_built INT NULL,
  address VARCHAR(255) NULL,
  postal_code VARCHAR(32) NULL,
  architect VARCHAR(255) NULL,
  total_yardage INT NULL,
  osm_id VARCHAR(64) NULL,
  source_updated_at VARCHAR(64) NULL,
  hole_pars_json JSON NULL,
  hole_handicaps_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_golf_courses_state_code_name (state_code, name),
  INDEX idx_golf_courses_normalized_name (state_code, normalized_name)
);

ALTER TABLE scores
  MODIFY COLUMN state VARCHAR(64) NOT NULL;
