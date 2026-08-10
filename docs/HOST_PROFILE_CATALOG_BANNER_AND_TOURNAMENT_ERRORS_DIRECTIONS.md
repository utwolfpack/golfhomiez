# Host Profile Catalog Defaults, Banner Upload, and Tournament Error Messages

## Summary

This change updates tournament validation and the host profile at `/host/portal/profile`.

Tournament create and edit actions now return user-facing, actionable validation messages in both the host and organizer flows. For example, publishing without a date returns:

> Tournament Start Date is a required field before publishing. Add a tournament date and try again.

The host profile now uses the `golf_courses` record associated with the authenticated host account to supply missing account and public-page information. The golf-course name is displayed as read-only and cannot be changed through the profile API.

The public golf-course banner is now a host-uploaded image. Uploaded JPG, PNG, and WebP files are resized and compressed in the browser, validated again by the server, and stored in `golf_course_public_pages.banner_image_data`. When no host image has been uploaded, the application displays its built-in golf-course banner.

## Host profile behavior

The host profile now:

- Uses `golf_courses.phone` when the host account phone is empty.
- Uses catalog data for missing course website, public contact phone, street address, city, state, and ZIP code values.
- Preserves values previously edited by the host instead of replacing them during later catalog synchronization.
- Displays **Golf Course Name** as read-only.
- Displays **Phone** and **Notes** instead of the former account-specific labels.
- Displays **Course Website URL**, **Public Contact Phone**, **Street Address**, **City**, **State**, and **Zip Code**.
- Removes the permanent-URL explanatory sentence while retaining the existing persistent public URL.
- Accepts a compressed host-uploaded banner of no more than 700 KB.
- Uses `src/assets/gallery/fairway-sunrise.svg` when no uploaded banner exists.

## Database migration

The following migration was added:

```text
migration_scripts/20260806_068_host_course_profile_banner.sql
```

It adds this nullable column when it does not already exist:

```sql
ALTER TABLE golf_course_public_pages
  ADD COLUMN banner_image_data MEDIUMTEXT NULL AFTER banner_image_url;
```

The migration is also registered in:

```text
server/migrations/index.js
```

The migration is idempotent and is executed by the existing `npm install` postinstall workflow.

## Deployment

1. Extract the changed-files ZIP into the GolfHomiez application root and preserve all directory paths.
2. Install dependencies and execute registered migrations:

   ```bash
   npm install
   ```

3. In stage and production environments, require successful database migration execution:

   ```env
   REQUIRE_DB_MIGRATIONS=true
   ```

4. Restart the existing PM2 or production process.

The application continues to obtain its runtime port from the existing environment configuration. No port value was added or hardcoded.

## Logging and correlation IDs

The existing request correlation ID continues to connect transactions across:

```text
logging/access.log
logging/api.log
logging/error.log
logging/frontend.log
```

Relevant events include:

- `host_profile_loaded`
- `host_profile_update_started`
- `host_profile_update_rejected`
- `host_profile_updated`
- `golf_course_public_page_catalog_defaults_applied`
- `golf_course_public_page_updated`
- `image_upload_started`
- `image_upload_completed`
- `image_upload_failed`
- Tournament validation rejection and save-failure events in the host and organizer portals

## Changed files for this request

```text
docs/HOST_PROFILE_CATALOG_BANNER_AND_TOURNAMENT_ERRORS_DIRECTIONS.md
migration_scripts/20260806_068_host_course_profile_banner.sql
server/index.js
server/lib/golf-course-public-pages.js
server/lib/rbac.js
server/migrations/index.js
src/lib/accounts.ts
src/lib/tournament-errors.ts
src/pages/GolfCoursePage.tsx
src/pages/HostPortal.tsx
src/pages/HostProfile.tsx
src/pages/OrganizerTournaments.tsx
test/app.test.js
test/golf-course-public-pages.test.js
```

## Verification completed

- Main application test suite: 203 passed, 0 failed.
- Dependency security tests: 8 passed, 0 failed.
- JavaScript syntax checks passed for all modified JavaScript files.
- TypeScript/TSX transpilation syntax checks passed for all modified TypeScript files.
- No dependency or package version was added or changed.

A registry-backed `npm audit --audit-level=high --omit=dev` was attempted, but the configured package registry returned HTTP 404 for the npm audit endpoint. Run the same command in an environment whose npm registry supports audit responses.

The production Vite build could not complete in this Linux workspace because the uploaded `node_modules` directory does not include Rollup's Linux native optional package (`@rollup/rollup-linux-x64-gnu`). A clean `npm install` on the target platform installs the correct native package and then executes the existing postinstall build.
