ALTER TABLE tournaments ADD COLUMN template_key VARCHAR(64) NULL AFTER is_public;
ALTER TABLE tournaments ADD COLUMN template_background_image_url LONGTEXT NULL AFTER template_key;
CREATE INDEX idx_tournaments_template_key ON tournaments (template_key);
