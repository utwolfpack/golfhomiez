DROP TABLE IF EXISTS verification_links;
DROP TABLE IF EXISTS invitations;
DELETE FROM app_schema_migrations WHERE version IN ('20260402_005', '20260403_006');
