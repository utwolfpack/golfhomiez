# Tournament Discovery Deployment and Operation

## Files and database objects

The tournament discovery and cleanup scheduled jobs are registered in `server/lib/scheduled-jobs.js` and are visible at `/golfadmin/scheduled-jobs` after the application starts. Tournament discovery currently includes `getTournaments`, `retryFailedTournamentWebsites`, and `scrubTournaments`.

Migration `migration_scripts/20260729_064_golf_course_tournament_search.sql` adds:

- `golf_courses.golf_course_website`, backfilled from the existing `website` value.
- `golf_course_tournaments`, the searchable upcoming tournament catalog.
- `golf_course_tournament_crawl_state`, which records crawl status and diagnostics per golf course.

Migration `migration_scripts/20260729_065_scheduled_job_configuration.sql` adds persisted scheduled-job configuration fields to `scheduled_jobs`:

- `schedule_type`
- `schedule_time`
- `schedule_day_of_week`
- `schedule_day_of_month`
- `job_config_json`

Both migrations are registered in `server/migrations/index.js`. The existing `postinstall` script runs `npm run db:migrate`, so normal `npm install` deployment applies schema changes automatically when the database is available. Set `REQUIRE_DB_MIGRATIONS=true` in environments where a failed migration must fail deployment rather than be skipped.

## Scheduled-job administration

`/golfadmin/scheduled-jobs` supports:

- **Run now** for manual execution.
- **Cancel job** while a job is running.
- **Schedule** to configure one of four modes:
  - Daily at a configurable time.
  - Weekly on a configurable day and time.
  - Monthly on a configurable day-of-month and time. If a month has fewer days than the configured value, the job runs on that month's last day.
  - Manual, which creates no automatic timer and requires **Run now**.
- A **Completed** column immediately after **Created**. It shows the last completion timestamp and the elapsed runtime for the last completed execution.

Schedules are persisted in the database and are reloaded on application startup. Changing a schedule immediately replaces the in-memory timer for that job without requiring a server restart. Job times use the job's configured time zone, currently `America/Denver` for the tournament jobs.

## `getTournaments`

The default `getTournaments` schedule remains daily at 02:00 Mountain Time unless changed through **Schedule**.

The first database operation in every run is:

```sql
TRUNCATE TABLE golf_course_tournaments;
```

This removes the complete previously discovered tournament catalog so the job rebuilds it from the current website crawl results. The application database user must therefore have permission to truncate this table.

After truncation, the job evaluates every nonblank `golf_courses.website` value, with `golf_course_website` retained only as a compatibility fallback when the source `website` value is blank. The course-selection query left-joins `golf_course_tournament_crawl_state` by golf-course ID so the current website can be compared with the website recorded by the last crawl attempt.

When the normalized current website matches `golf_course_tournament_crawl_state.website` and `last_status` is `failed`, `getTournaments` does not request that website. It logs `tournament_crawl_course_skipped_previous_failure` with the correlation ID, course, current/recorded website, previous error, record sequence, and `continuing: true`, increments `coursesSkippedPreviousFailure`, and proceeds to the next golf-course record. The failed crawl-state row is left unchanged so `retryFailedTournamentWebsites` can retry it. When the course website has changed since the failure, the new website is crawled normally.

Successful crawls extract upcoming tournament dates and insert/upsert the rebuilt results into `golf_course_tournaments`. The accepted tournament-date window is inclusive: the run date through the date six calendar months later. Past dates and dates after that six-month boundary are ignored and never inserted.

The crawler:

- only follows HTTP/HTTPS URLs;
- rejects localhost/private-network destinations;
- limits redirects, response size, request duration, and pages per course while continuing through every eligible course website record in the run;
- checks `robots.txt` before crawling pages and honors matching `Allow`/`Disallow` rules using longest-match precedence;
- treats a site that disallows the course root in `robots.txt` as an expected `skipped_robots` result instead of a crawl failure;
- never bypasses a site's `robots.txt` restriction just to obtain tournament data;
- treats each course as an independent unit of work: a fetch, parse, robots, tournament-write, or crawl-state error is logged with the correlation ID and processing continues with the next website record;
- rebuilds the discovered tournament catalog from an empty table on each run, excluding unchanged websites currently deferred because their matching crawl-state status is `failed`.

The following optional environment variables tune per-site crawler safety limits without limiting the number of golf-course website records processed:

- `TOURNAMENT_CRAWL_MAX_PAGES_PER_COURSE` (default `4`)
- `TOURNAMENT_CRAWL_TIMEOUT_MS` (default `10000`)

There is intentionally no per-run course limit or time-based crawl backoff filter. Both scheduled and **Run now** executions inspect every populated website record unless an administrator cancels the running job; only an unchanged website whose matching crawl-state `last_status` is `failed` is skipped by `getTournaments` and left for the retry job.

## `retryFailedTournamentWebsites`

`retryFailedTournamentWebsites` is registered as a scheduled job with **Manual** as its default schedule. It can be assigned a Daily, Weekly, or Monthly schedule through the same **Schedule** dialog used by the other jobs.

The job selects crawl-state rows where `last_status = 'failed'` and only retries a row when the recorded crawl-state `website` still matches the golf course's current `website`/`golf_course_website` value. This prevents an obsolete failed URL from being retried after a course changes its website.

For every retry:

- a successful crawl writes `last_status = 'success'`, refreshes `last_success_at`, clears `last_error`, and updates page/tournament counts;
- an HTTP, validation, parsing, or other crawl failure leaves the row at `last_status = 'failed'` with the new error details;
- a legitimate robots restriction updates the row to `skipped_robots` rather than treating the site as a successful crawl;
- a failure on one website is logged and the retry job continues to the next failed website;
- cancellation stops the retry loop using the same scheduled-job cancellation mechanism as `getTournaments`.

## `scrubTournaments`

`scrubTournaments` is registered as a scheduled job with **Manual** as its default schedule.

Open **Schedule** for `scrubTournaments` to add or remove tournament-name scrub values. The values are stored in `scheduled_jobs.job_config_json`. When the job executes, each configured value is evaluated independently and records are deleted from `golf_course_tournaments` when `tournament_name` contains that value, case-insensitively.

The values are treated as literal text. SQL wildcard characters in a configured value are escaped rather than interpreted as wildcard operators. Blank values are ignored and duplicate values are removed case-insensitively. Errors for one configured value are logged and processing continues with the next value.

## Cancelling a running job

When a scheduled job is active, `/golfadmin/scheduled-jobs` replaces **Run now** with **Cancel job**. The cancellation request is cooperative and safe:

- the server records the run as `cancel_requested`;
- an `AbortController` signals the running job;
- in-flight tournament website requests are aborted immediately;
- loops stop before starting the next course/page/database write;
- a database operation already in progress is allowed to finish before cancellation completes;
- the final run status becomes `cancelled`, preserving partial summary information when available;
- a second run of the same job is rejected while the first run remains active.

Cancellation is handled by `POST /api/admin/scheduled-jobs/:id/cancel`. Schedule changes are handled by `PUT /api/admin/scheduled-jobs/:id/schedule`.

## Tournament search pages

Tournament discovery search has moved out of `/my-tournaments` to the dedicated authenticated route `/find-tournament`.

`/my-tournaments` now uses the title **My Tournaments** and places a **Find Tournament** button to the right of the page title. Selecting the button navigates to `/find-tournament`.

`/find-tournament` searches the discovered catalog by state, city, Zip Code, golf course name, and date range. On page load, the state filter defaults to the signed-in golfer's profile state when available, the From Date defaults to today, and the To Date defaults to 14 days from today. The maximum selectable date is six calendar months from today.

City and golf-course-name filters use server-side typo-tolerant token matching. Exact substrings still match, while small spelling differences such as `Sallt Lke` → `Salt Lake` or `Mountan Vew` → `Mountain View` can also match. Zip Code matching is literal/prefix based (for example `841` matches `84101`) and is not treated as an SQL wildcard expression.

The previous MySQL `LIKE ... ESCAPE '\\'` clauses were removed from these filters. This resolves the `ER_PARSE_ERROR` seen on MySQL installations that parsed the generated escape literal as an unterminated string.

The page intentionally omits the previous finder title/subtitle and keeps a light-green **My Tournaments** return button aligned with the support-page return action. The total number of matching records appears beneath **Search tournaments** with minor emphasis.

Search responses remain paginated at 20 records per page. State/date restrictions are applied by MySQL, then city/course fuzzy matching and Zip Code filtering are applied on the server before the 20-record page is returned to the browser. Search results display:

1. Golf course name as the heavily emphasized first line without a `Course:` prefix.
2. Tournament date and location with medium emphasis on the second line.
3. Tournament name with lower emphasis on the final line.

The crawler, browser, and API enforce a date window from the current date through six calendar months in the future. Tournament dates outside that window are not stored or returned.

## Logging and correlation IDs

HTTP requests continue to receive a shared `X-Correlation-Id`. Tournament search frontend events are written to `logging/frontend.log`, API/search and crawler events to `logging/api.log`, request lifecycle entries to `logging/access.log`, and crawler/scheduled-job details to `logging/scheduled-jobs.log`. Errors are written to `logging/error.log`.

Schedule changes, scrub activity, failed-website skips/retries, manual runs, cancellations, and tournament-search actions all emit correlated log events. A `getTournaments` skip caused by a matching failed crawl state is written as `tournament_crawl_course_skipped_previous_failure` to the API and scheduled-job logs at warning level, without generating another crawl failure. Cancellation logs include both the running job correlation ID and the cancellation request correlation ID so the original job lifecycle and the admin cancellation request can both be traced. A `robots.txt` root restriction is logged as a skip/information event rather than an application error.
