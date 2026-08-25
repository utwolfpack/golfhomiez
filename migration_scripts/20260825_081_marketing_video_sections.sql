CREATE TABLE IF NOT EXISTS marketing_video_sections (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  audience VARCHAR(32) NOT NULL,
  section_name VARCHAR(191) NOT NULL,
  youtube_url TEXT NOT NULL,
  section_slug VARCHAR(191) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_by_admin_user_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_marketing_video_sections_audience_slug (audience, section_slug),
  INDEX idx_marketing_video_sections_audience_order (audience, display_order),
  INDEX idx_marketing_video_sections_updated_at (updated_at),
  INDEX idx_marketing_video_sections_correlation (correlation_id)
);

INSERT IGNORE INTO marketing_video_sections
  (id, audience, section_name, youtube_url, section_slug, display_order)
VALUES
  ('default-user-create-account', 'golf_homiez', 'Create a Golf Homiez Account', 'https://www.youtube.com/shorts/Tj2D1R2rsSU?feature=share', 'create-a-golf-homiez-account', 10),
  ('default-user-team-tournament', 'golf_homiez', 'Create a team and register for a tournament', 'https://www.youtube.com/shorts/Tj2D1R2rsSU?feature=share', 'create-a-team-and-register-for-a-tournament', 20),
  ('default-user-challenge', 'golf_homiez', 'Create a challenge', 'https://www.youtube.com/shorts/Tj2D1R2rsSU?feature=share', 'create-a-challenge', 30),
  ('default-user-log-round', 'golf_homiez', 'Log a round', 'https://www.youtube.com/shorts/Tj2D1R2rsSU?feature=share', 'log-a-round', 40),
  ('default-course-manage-website', 'golf_homiez_courses', 'Manage Your Golf Homiez Website', 'https://www.youtube.com/shorts/Tj2D1R2rsSU?feature=share', 'manage-your-golf-homiez-website', 10),
  ('default-course-create-tournament', 'golf_homiez_courses', 'Create a Tournament', 'https://www.youtube.com/shorts/Tj2D1R2rsSU?feature=share', 'create-a-tournament', 20),
  ('default-course-manage-account', 'golf_homiez_courses', 'Manage your Golf Homiez Golf Course Account', 'https://www.youtube.com/shorts/Tj2D1R2rsSU?feature=share', 'manage-your-golf-homiez-golf-course-account', 30);
