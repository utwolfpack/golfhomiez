# Golfbert API implementation directions

## What changed

Golf course catalog, course metadata, scorecard par, yards, stroke index, and flag-distance calculations now come from the Golfbert API instead of the local database, CSV import, or static course files.

The backend uses:

- `GET /api/v1/courses` for course search/listing.
- `GET /api/v1/courses/{id}/holes` for hole par, yards, stroke index, and flag coordinate data.

The implementation intentionally does not call `v1/holes/{id}/polygons`.

## Environment variables to add to `.env`

Add these values in every local, staging, and production environment:

```env
GOLFBERT_API_KEY=replace_with_your_golfbert_api_key
GOLFBERT_API_BASE_URL=https://golfbert.com/api/v1
GOLFBERT_API_KEY_HEADER=X-API-Key
GOLFBERT_API_AUTH_SCHEME=header
GOLFBERT_CACHE_TTL_MS=900000
```

If Golfbert requires bearer tokens instead of `X-API-Key`, change:

```env
GOLFBERT_API_AUTH_SCHEME=bearer
```

If Golfbert requires the key as a query-string parameter, change:

```env
GOLFBERT_API_AUTH_SCHEME=query
GOLFBERT_API_KEY_QUERY_PARAM=api_key
```

Do not commit real `.env` secrets. The example env files have been updated only with placeholder values.

## Database migration deployment

A new migration was added:

```text
migration_scripts/20260521_050_remove_local_golf_course_datasource.sql
```

It removes the old local course datasource tables:

```sql
DROP TABLE IF EXISTS golf_course_hole_scorecards;
DROP TABLE IF EXISTS golf_courses;
```

The migration is registered in:

```text
server/migrations/index.js
```

`package.json` already runs migrations during install through:

```json
"postinstall": "npm run db:migrate && npm run build"
```

To apply manually in an existing environment, run:

```bash
npm run db:migrate
```

For a production deploy, add the Golfbert `.env` settings first, deploy the changed files, then run `npm install` or `npm run db:migrate` as part of the release process.

## Removed obsolete local datasource files

Delete these files from the application tree when applying this change set:

```text
opengolfapi-us.courses.042026.csv
server/course-data.js
server/lib/course-catalog.js
server/scripts/import-golf-courses.js
src/data/courseDetails.ts
src/data/coursesByState.ts
src/data/utahCourses.ts
```

The old `golf-courses:import` script was removed from `package.json`.

## Logging and correlation IDs

The existing logging system is used for this work and each Golfbert transaction is bound to the shared `X-Correlation-Id` lifecycle:

```text
logging/access.log
logging/api.log
logging/error.log
logging/frontend.log
```

Golfbert server calls write request start/completion entries to `logging/api.log`; failures write to `logging/error.log`; browser scorecard/course loading transactions write to `logging/frontend.log`; HTTP request lifecycle entries write to `logging/access.log`.

Search the same correlation ID across those files to trace a full transaction.

## Verification commands

Run these from the application root:

```bash
npm test
npm run build
```

Both commands passed after these changes.
