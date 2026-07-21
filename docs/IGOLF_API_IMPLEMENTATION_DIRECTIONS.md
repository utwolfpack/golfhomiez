# iGolf Connect API implementation directions

This change replaces the previous Golfbert course datasource with iGolf Connect Standard API calls against `https://standard-connect.igolf.com`.

## Environment variables to add or update

Add these to each `.env` file before starting the app:

```bash
IGOLF_CONNECT_API_KEY=replace_with_igolf_api_key
IGOLF_CONNECT_SECRET_KEY=replace_with_igolf_secret_key
IGOLF_CONNECT_BASE_URL=https://standard-connect.igolf.com
IGOLF_CONNECT_CACHE_TTL_MS=900000
IGOLF_CONNECT_STATE_PARAM=state
```

`IGOLF_CONNECT_STATE_PARAM` is optional. It defaults to `state`. If iGolf tells you the CourseList request body expects a different field name for state filtering, set that field name here without changing application code.

The optional iGolf Web 3D Viewer variables are:

```bash
IGOLF_VIEWER_API_KEY=replace_with_viewer_api_key
IGOLF_VIEWER_KEY=replace_with_viewer_key
IGOLF_VIEWER_SCRIPT_URL=https://viewer.igolf.com/igolf-3d-viewer.js
IGOLF_VIEWER_STYLE=a
IGOLF_VIEWER_SUBSTYLE=v1
IGOLF_VIEWER_COLOR_ACCENT=#0094cc
IGOLF_VIEWER_SCORECARD=false
```

Leave `IGOLF_VIEWER_API_KEY` and `IGOLF_VIEWER_KEY` blank if the viewer package is not enabled. The app will continue showing the existing in-app hole map with iGolf scorecard/GPS data.

Remove the old Golfbert variables from deployed `.env` files:

```bash
GOLFBERT_API_KEY
GOLFBERT_API_BASE_URL
GOLFBERT_API_KEY_HEADER
GOLFBERT_API_AUTH_SCHEME
GOLFBERT_API_ACCESS_KEY
GOLFBERT_API_SECRET_KEY
GOLFBERT_API_REGION
GOLFBERT_API_SERVICE
GOLFBERT_CACHE_TTL_MS
GOLFBERT_COURSE_PAGE_SIZE
```

## API calls used

The server signs each iGolf request using the Postman collection flow:

1. Build `action/apiKey/1.1/2.0/HmacSHA256/date/JSON`.
2. Sign it with `HmacSHA256` using `IGOLF_CONNECT_SECRET_KEY`.
3. Convert the base64 signature to URL-safe form by replacing `/` with `_`, `+` with `-`, and removing `=`.
4. POST JSON to `/{Action}/{signedPath}`.

Implemented endpoints:

- `CourseList` for state/course dropdowns and course resolution.
- `CourseScorecardDetails` for hole par, yards, and stroke index.
- `CourseTeeDetails` only when the scorecard response is missing par, yardage, or stroke index.
- `CourseGPSDetails` for front, center, and back green coordinates.

The application caches iGolf results for `IGOLF_CONNECT_CACHE_TTL_MS`, so a full round normally performs the minimum flow: one CourseList call for selecting/resolving the course, one CourseScorecardDetails call, and one CourseGPSDetails call. CourseTeeDetails is only a fallback enrichment call.

## Application paths changed

Server:

- `server/lib/igolf-client.js`
- `server/lib/golf-course-service.js`
- `server/lib/hole-scorecard.js`
- `server/lib/external-api-metrics.js`
- `server/index.js`

Client:

- `src/lib/golf-courses.ts`
- `src/hooks/useGolfCourseStates.ts`
- `src/lib/hole-scorecard.ts`
- `src/types.ts`
- `src/components/IgolfHoleViewer.tsx`
- `src/components/HoleByHoleScorecard.tsx`
- `src/pages/SoloLogger.tsx`
- `src/pages/GolfLogger.tsx`
- `src/pages/Challenges.tsx`
- `src/pages/CreateHostAccount.tsx`
- `src/pages/Home.tsx`
- `src/pages/MyGolfScores.tsx`
- `src/pages/AdminPortal.tsx`
- `src/index.css`

Configuration/tests:

- `.env.example`
- `test/app.test.js`

Removed files:

- `server/lib/golfbert-client.js`
- `GOLFBERT_API_IMPLEMENTATION_DIRECTIONS.md`

## Deployment steps

1. Copy the changed files into the application at the same paths.
2. Delete the removed Golfbert files listed above.
3. Update `.env` with the iGolf variables.
4. Run `npm install` in the target environment. The existing `postinstall` script runs `npm run db:migrate && npm run build`.
5. Restart the Node process or PM2 service.
6. Test `/api/golf-course-states`, `/api/golf-courses?state=UT`, and the solo/team scorecard flow.

## Migrations

No schema changes were required for this iGolf conversion. No new migration script was created. Existing migrations still run through the current `npm install` postinstall process.

## Logging and correlation IDs

The existing logging middleware remains in use. iGolf request start/completion entries write to `logging/api.log`, request lifecycle entries write to `logging/access.log`, browser course/state/viewer events write to `logging/frontend.log`, and failures write to `logging/error.log`. The same correlation id is propagated through `X-Correlation-Id` and the front-end logger so a transaction can be searched across all log files.
