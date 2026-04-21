Changed application paths

Backend
- server/lib/golf-course-service.js — CSV import, course search, exact course lookup.
- server/index.js — new GET /api/golf-courses endpoint and score validation against the catalog.
- server/storage/mysql.js — persists golf_course_id and course rating metadata on scores.
- server/migrations/index.js — registers schema migration 20260420_016.
- migration_scripts/20260420_016_golf_courses_catalog.sql — creates golf_courses and golf_course_holes and extends scores.
- server/scripts/import-golf-courses.js — one-time importer for the uploaded CSV.

Frontend
- src/components/GolfCourseInput.tsx — shared catalog-backed golf course input.
- src/hooks/useGolfCourseOptions.ts — debounced catalog search hook.
- src/lib/golf-courses.ts — frontend API client for the catalog.
- src/pages/SoloLogger.tsx — uses the catalog-backed golf course input.
- src/pages/GolfLogger.tsx — uses the catalog-backed golf course input.
- src/pages/CreateHostAccount.tsx — uses the catalog-backed golf course input.
- src/pages/AdminPortal.tsx — uses the catalog-backed golf course input.
- src/lib/request.ts and src/lib/locations.ts — reuse the session correlation id for log stitching.
- src/lib/handicap.ts — now depends on score-stored rating data instead of bundled course seed data.

Removed obsolete golf-course artifacts
- server/course-data.js
- src/data/courseDetails.ts
- src/data/coursesByState.ts
- src/data/utahCourses.ts

Migration and deployment steps
1. Deploy the code changes.
2. Run the app migrations:
   npm run db:migrate
3. Import the golf course catalog data from the CSV available in the project root:
   npm run golf-courses:import
4. Restart the application.

Notes
- The importer reads opengolfapi-us.courses.042026.csv by default.
- Override the CSV path with GOLF_COURSES_CSV_PATH if production stores the file elsewhere.
- Score creation now requires a course that exists in the imported catalog for the selected state.
