-- Stores the host-uploaded public golf-course banner separately from legacy website banner URLs.
-- The uploaded image is compressed by the client and stored as a safe image data URL.

SET @has_banner_image_data := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'golf_course_public_pages'
    AND COLUMN_NAME = 'banner_image_data'
);
SET @sql := IF(
  @has_banner_image_data = 0,
  'ALTER TABLE golf_course_public_pages ADD COLUMN banner_image_data MEDIUMTEXT NULL AFTER banner_image_url',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
