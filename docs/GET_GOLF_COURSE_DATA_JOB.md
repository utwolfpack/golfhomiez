# getGolfCourseData scheduled job

## Purpose

`getGolfCourseData` refreshes the local `golf_courses` and `golf_course_holes` catalog from OpenGolfAPI. It is registered in **GolfAdmin > Scheduled jobs** and defaults to **Manual**. An administrator can run it with **Run now** or use **Schedule** to change it to daily, weekly, or monthly execution.

The job runs as a background manual job so a full United States refresh does not hold the GolfAdmin HTTP request open. The existing Scheduled Jobs page shows its active state, run output, correlation ID, and Cancel action.

## OpenGolfAPI data flow

The default implementation now uses a **fast path** designed around the approximately 12-hour full-US target.

For each US state plus District of Columbia, the job performs this flow:

1. Download the official OpenGolfAPI US bulk catalog once per run and use it as the complete course-metadata/scorecard source.
2. Read `GET https://api.opengolfapi.org/v1/courses/state/{STATE}?limit=500` for each state as a validation/supplement source and merge it with the bulk catalog.
3. For every unique course ID, start the `/holes` and `/tees` requests concurrently:
   - `GET /v1/courses/{id}/holes` supplies hole yardages and handicap/stroke-index data.
   - `GET /v1/courses/{id}/tees` supplies tee-set yardage, course rating, and slope rating.
4. Upsert course metadata while those endpoint requests are in flight.
5. Replace OpenGolfAPI-owned hole rows with a **single multi-row INSERT per course** rather than one SQL round trip per hole.

The fast path intentionally does **not** call `GET /v1/courses/{id}` for every course. OpenGolfAPI's own API implementation shows that endpoint selects the course row and adds only the scorecard (`hole_number`, `par`, `handicap_index`). The official bulk catalog already contains the course metadata and scorecard data needed by GolfHomiez, while `/holes` supplies the richer hole data the application requires. Removing the redundant detail call cuts the REST requirement from roughly three calls per course to two.

Set `OPEN_GOLF_API_USE_COURSE_DETAIL_ENDPOINT=true` only for troubleshooting or legacy parity. It adds one REST call per course and materially increases runtime and quota requirements.

The current OpenGolfAPI state handler caps its response at 500 and does not expose offset/cursor pagination. Because some states can exceed that cap, the importer still calls the state endpoint but supplements it from the official bulk dataset so courses beyond the endpoint cap are not silently omitted.

## Performance target and quota requirements

OpenGolfAPI currently publishes 16,908 US courses. With the default fast path the approximate REST call count is:

- 51 state validation calls (50 states + DC)
- 2 enrichment calls per course (`/holes` + `/tees`)
- about **33,867 REST calls** for a full current US run

At the default `OPEN_GOLF_API_REQUEST_INTERVAL_MS=750`, the request-start pacing component is about 7.1 hours. Course concurrency (`OPEN_GOLF_API_IMPORT_CONCURRENCY=8`) overlaps network time with MySQL work, and batch hole inserts remove most of the former per-hole database round trips. This leaves operating headroom for network latency, retries, and database work inside the approximate 12-hour target.

A 12-hour full-US run is **not possible with anonymous quota**. OpenGolfAPI documents 1,000 anonymous requests/day and keyed tiers including 10k, 50k, 250k, and 1M requests/day. The current fast-path request count therefore requires a key whose available daily quota is at least the estimate reported by `golf_course_data_import_plan`; with the current catalog that means a 50k/day-or-higher allowance for a single-day run.

The job logs an import plan before course enrichment starts. The plan includes:

- `courseCount`
- `requestsPerCourse`
- `estimatedApiRequests`
- `estimatedThrottleHours`
- `recommendedDailyQuota`
- `courseConcurrency`
- `targetRunHours`
- whether the configured throttle alone can satisfy the target

## Daily rate-limit handling and long-running fallback

The job still reads `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` from OpenGolfAPI. Daily-limit exhaustion remains a normal pause/resume condition rather than a job failure.

Fast mode disables the old whole-day adaptive pacing by default because spreading the quota across the entire remaining UTC day can unnecessarily push a capable 50k+ key beyond the 12-hour target. Instead, requests use the configured 750 ms minimum spacing. If the account cannot supply the required daily quota, the importer pauses at the daily limit and resumes after the UTC reset. That fallback is safe, but the run will necessarily exceed 12 hours.

Other behavior remains unchanged:

- The importer reserves a small number of calls (`OPEN_GOLF_API_RATE_LIMIT_RESERVE`, default `5`).
- HTTP `429` daily-limit responses do not fail the course/job when `OPEN_GOLF_API_WAIT_FOR_DAILY_RESET=true`.
- Daily-reset waits do not consume the normal transient retry count.
- Normal `408`, non-daily `429`, and `5xx` responses use bounded exponential retries.
- Long waits are tied to the scheduled-job `AbortSignal`, so **Cancel job** interrupts a wait immediately.
- API keys are sent only in the Authorization header and are never written to logs.

## Field mapping

### `golf_courses`

The official bulk/state course record populates the user-friendly course columns already defined by migration `20260630_059`, including:

- `external_course_id`
- `name` / `normalized_name`
- `state_code` / `state_name`
- `county`
- `city`
- `country`
- `course_type`
- `holes_count`
- `par_total`
- `address`
- `postal_code`
- `phone`
- `website`
- `latitude` / `longitude`
- `raw_list_payload`
- `raw_detail_payload`

The `/tees` payload populates:

- `total_yardage`: prefer a White tee set with a yardage; otherwise use the first tee set that has yardage; otherwise `NULL`.
- `course_rating`: prefer a White tee set with a course rating; otherwise use the first tee set that has a course rating; otherwise `NULL`.
- `slope_rating`: prefer a White tee set with a slope rating; otherwise use the first tee set that has a slope rating; otherwise `NULL`.
- `raw_tees_payload`: complete diagnostic copy of the latest `/tees` response.

`raw_holes_payload` stores the latest `/holes` response separately. In fast mode, `raw_detail_payload` contains the official bulk/state course record rather than a redundant `/courses/{id}` response.

### `golf_course_holes`

For each hole/tee row returned by `/courses/{id}/holes`:

- `yardages` -> `yards` for the applicable tee.
- `handicap_index` -> `stroke_index`.
- `tee_coords` -> `tee_latitude` / `tee_longitude` when present.
- `green`, `green_polygon`, or equivalent green geometry -> `front_latitude`, `front_longitude`, `center_latitude`, `center_longitude`, `back_latitude`, `back_longitude` when present.
- `par` -> `par`.
- the original hole object -> `raw_payload`.

OpenGolfAPI currently may omit derived tee/green geometry from the free `/holes` response. When those values are not returned, the corresponding database coordinate fields remain `NULL`; the parser is ready to populate them when the endpoint provides them.

## Schema migrations and deployment

The application already has ordered migrations that create the base catalog tables:

- `migration_scripts/20260630_059_opengolfapi_database_catalog.sql` creates `golf_courses` and `golf_course_holes` with `CREATE TABLE IF NOT EXISTS`.
- `migration_scripts/20260702_060_opengolfapi_hole_endpoint_geometry.sql` adds tee coordinate support.
- `migration_scripts/20260811_072_golf_course_data_import_support.sql` adds separate `raw_holes_payload` and `raw_tees_payload` fields.

`package.json` already executes `npm run db:migrate` during `postinstall`, so a normal deployment/install applies these schema changes before the application build. Do not run the data import from a schema migration: the OpenGolfAPI import is an operational scheduled job and can be retried/cancelled independently of schema deployment.

## Environment configuration

Add values to the target environment as needed:

```dotenv
OPEN_GOLF_API_BASE_URL=https://api.opengolfapi.org
OPEN_GOLF_API_KEY=
OPEN_GOLF_API_BULK_DATASET_URL=https://github.com/opengolfapi/data/releases/latest/download/opengolfapi-us.geojson.gz
OPEN_GOLF_API_STATE_PAGE_LIMIT=500
OPEN_GOLF_API_FAST_MODE=true
OPEN_GOLF_API_USE_COURSE_DETAIL_ENDPOINT=false
OPEN_GOLF_API_IMPORT_CONCURRENCY=8
OPEN_GOLF_API_TARGET_RUN_HOURS=12
OPEN_GOLF_API_REQUEST_INTERVAL_MS=750
OPEN_GOLF_API_MAX_RETRIES=6
OPEN_GOLF_API_RETRY_BASE_MS=2000
OPEN_GOLF_API_RETRY_MAX_MS=120000
OPEN_GOLF_API_RATE_LIMIT_RESERVE=5
OPEN_GOLF_API_RATE_LIMIT_RESET_GRACE_MS=5000
OPEN_GOLF_API_WAIT_FOR_DAILY_RESET=true
OPEN_GOLF_API_ADAPTIVE_DAILY_PACING=false
OPEN_GOLF_API_IMPORT_DELAY_MS=0
OPEN_GOLF_API_IMPORT_STATE_DELAY_MS=0
```

The key is optional for API reads, but a complete nationwide fast refresh still performs roughly two REST calls per course. Configure `OPEN_GOLF_API_KEY` with enough daily quota for the run-plan estimate before a full production refresh. With the current 16,908-course catalog, a 50k/day-or-higher allowance is the practical minimum for the approximately 12-hour target. The key is sent only as the Bearer authorization header and is never written to application logs.

## Running manually

1. Deploy/install the application so migrations run.
2. Sign in to GolfAdmin.
3. Open **Admin > Scheduled jobs**.
4. Find **getGolfCourseData**. Its default schedule is **Manual**.
5. Select **Run now** and confirm.
6. The request returns after the background job is accepted. Use **Refresh jobs** to inspect the latest status/output.
7. Use **Cancel job** if the active import needs to stop.
8. Search `access.log`, `api.log`, `frontend.log`, `error.log`, and `scheduled-jobs.log` by the run correlation ID to follow the transaction lifecycle.

To schedule future execution, choose **Schedule**, select daily/weekly/monthly, set the time/day, and save. Selecting **Manual** disables automatic execution again.

## Manual golf-course records

The schema deliberately supports courses that do not exist in OpenGolfAPI. For a manual course:

- set `source = 'manual'`
- set `is_manual = 1`
- use a unique local `id`
- leave `external_course_id` `NULL`
- provide `name`, `normalized_name`, and `state_code`
- add one `golf_course_holes` row per hole/tee combination that should be available to score logging

Example course DML:

```sql
INSERT INTO golf_courses (
  id,
  external_course_id,
  source,
  name,
  normalized_name,
  state_code,
  state_name,
  city,
  country,
  holes_count,
  par_total,
  total_yardage,
  course_rating,
  slope_rating,
  is_manual,
  active,
  imported_at
) VALUES (
  'manual-ut-example-golf-club',
  NULL,
  'manual',
  'Example Golf Club',
  'example golf club',
  'UT',
  'Utah',
  'Provo',
  'US',
  18,
  72,
  6400,
  70.2,
  125,
  1,
  1,
  UTC_TIMESTAMP()
);
```

Example hole DML:

```sql
INSERT INTO golf_course_holes (
  id,
  course_id,
  source,
  hole_number,
  tee_name,
  tee_color,
  par,
  yards,
  stroke_index,
  tee_latitude,
  tee_longitude,
  front_latitude,
  front_longitude,
  center_latitude,
  center_longitude,
  back_latitude,
  back_longitude,
  active
) VALUES (
  'manual-ut-example-golf-club-hole-1-white',
  'manual-ut-example-golf-club',
  'manual',
  1,
  'White',
  'white',
  4,
  410,
  7,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  1
);
```

Because OpenGolfAPI refreshes delete/replace only rows where `source = 'opengolfapi'`, manual hole rows are not deleted by this job.

## Logging and diagnostics

All manual GolfAdmin requests already carry `X-Correlation-Id`. The same ID is passed into `getGolfCourseData`, its OpenGolfAPI HTTP calls, external API metrics, database upsert diagnostics, scheduled-job events, and errors. Important events include:

- `admin_scheduled_job_manual_run_requested`
- `admin_scheduled_job_background_run_accepted`
- `golf_course_data_import_started`
- `golf_course_data_import_plan`
- `golf_course_data_state_started`
- `golf_course_data_state_discovered`
- `golf_course_data_course_imported`
- `golf_course_data_course_failed`
- `golf_course_data_state_completed`
- `golf_course_data_import_completed`
- `golf_course_data_import_cancelled`
- `opengolfapi_request_started`
- `opengolfapi_rate_limit_observed`
- `opengolfapi_request_throttled`
- `opengolfapi_daily_limit_reached`
- `opengolfapi_daily_limit_wait_started`
- `opengolfapi_daily_limit_wait_completed`
- `opengolfapi_request_retry_scheduled`
- `opengolfapi_request_completed`

Failures are sampled in the scheduled-job output so the administrator can identify state/course/phase without retaining an unbounded error array.
