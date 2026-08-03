-- Adds the crawl/search data store used by the getTournaments scheduled job.
-- The application migration runner applies this during npm install via `npm run db:migrate`.

ALTER TABLE golf_courses
  ADD COLUMN golf_course_website VARCHAR(1024) NULL AFTER website;

UPDATE golf_courses
   SET golf_course_website = website
 WHERE (golf_course_website IS NULL OR TRIM(golf_course_website) = '')
   AND website IS NOT NULL
   AND TRIM(website) <> '';

CREATE TABLE IF NOT EXISTS golf_course_tournaments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  discovery_key CHAR(64) NOT NULL,
  golf_course_id VARCHAR(64) NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  tournament_name VARCHAR(255) NULL,
  state_code VARCHAR(8) NOT NULL,
  city VARCHAR(128) NULL,
  zip_code VARCHAR(32) NULL,
  tournament_date DATE NOT NULL,
  tournament_website VARCHAR(1024) NULL,
  source_url VARCHAR(1024) NOT NULL,
  discovered_text TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  correlation_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_golf_course_tournaments_discovery_key (discovery_key),
  KEY idx_golf_course_tournaments_state_date (state_code, tournament_date),
  KEY idx_golf_course_tournaments_city_date (city, tournament_date),
  KEY idx_golf_course_tournaments_zip_date (zip_code, tournament_date),
  KEY idx_golf_course_tournaments_course_date (golf_course_name, tournament_date),
  KEY idx_golf_course_tournaments_active_date (active, tournament_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS golf_course_tournament_crawl_state (
  golf_course_id VARCHAR(64) NOT NULL PRIMARY KEY,
  golf_course_name VARCHAR(191) NOT NULL,
  website VARCHAR(1024) NOT NULL,
  last_crawled_at DATETIME NULL,
  last_success_at DATETIME NULL,
  next_crawl_after DATETIME NULL,
  last_status VARCHAR(32) NULL,
  last_error TEXT NULL,
  pages_crawled INT UNSIGNED NOT NULL DEFAULT 0,
  tournaments_found INT UNSIGNED NOT NULL DEFAULT 0,
  correlation_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_golf_course_tournament_crawl_next (next_crawl_after),
  KEY idx_golf_course_tournament_crawl_status (last_status, last_crawled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
