ALTER TABLE golf_courses ADD COLUMN address VARCHAR(255) NULL AFTER city;
ALTER TABLE golf_courses ADD COLUMN postal_code VARCHAR(32) NULL AFTER address;
