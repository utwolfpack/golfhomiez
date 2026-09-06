# Golf-course account approval and live leaderboard

## Scope

This change adds golf-course-owned approval for additional host account requests and a public, display-oriented live leaderboard for published tournaments.

## Guest navigation

When no user is logged in, the navigation dropdown now shows **Golf Course Login** instead of **Host Login**. Directly below it is **Create Golf Course Account**, which opens `/host/register`.

## Golf-course account request routing

`POST /api/host/account-requests` still validates the requested golf course against the course catalog. After validation, the server checks for an existing validated host account for that course with `is_course_admin = 1`.

If a primary course host exists:

- `approval_route` is stored as `course_primary_host`.
- The primary host account id and email are stored with the request.
- The requester receives an email identifying the current primary golf-course account admin and explaining that the request was routed to that host team.
- The primary host receives an awareness email containing the requester details and a link to `/host/login`.
- The Golf Homiez admin approval path is not allowed to approve that routed request.
- Any validated host belonging to the same golf course can see the pending request in the host portal and approve or deny it.

If the course does not yet have a validated primary host, the existing Golf Homiez admin approval flow remains in place.

### Host review API

`POST /api/host/account-requests/:id/review`

Body:

```json
{ "decision": "approve" }
```

or

```json
{ "decision": "deny" }
```

The endpoint requires a valid host session and verifies that the reviewing host belongs to the same golf course as the routed request. On approval, the requested host account is validated for the course and remains a non-admin host when that course already has validated hosts. On denial, the request is marked denied. The requester receives the corresponding email notification.

## Database migration

Migration `20260904_085_host_course_account_request_approval` adds the following fields to `host_account_requests`:

- `approval_route`
- `routed_host_account_id`
- `routed_host_email`
- `reviewed_by_host_account_id`

It also adds indexes for route/status lookups and routed-host lookups.

The migration is registered in `server/migrations/index.js`. The existing `postinstall` process remains:

```text
npm run cleanup:project-files && npm run db:migrate && npm run build
```

This means deployment environments receive the schema update during the normal `npm install` process.

## Published tournament live leaderboard

Published tournaments in the host portal now show a QR code section followed by a **Leaderboard** link. The link opens:

`/tournaments/:id/leaderboard`

The dedicated page is intended for a large course display during the tournament. It includes tournament name, course, date, location, format/start information when available, and a stack-ranked team leaderboard.

Leaderboard columns are:

- Rank
- Team
- Round Score relative to par (`-3`, `Par`, `+3`, and so on)
- Thru
- Total Strokes

The live leaderboard response intentionally omits individual hole rows and team-member detail. The browser refreshes the leaderboard every 30 seconds and also refreshes when the page becomes visible again.

### Public API

`GET /api/tournament-portals/:id/leaderboard`

The endpoint is available only for public tournament states (`published` and `completed`), uses `Cache-Control: no-store`, and returns:

- sanitized public tournament information
- stack-ranked live leaderboard rows
- `refreshedAt`
- `refreshIntervalSeconds: 30`
- `holeByHoleIncluded: false`

## Logging and correlation IDs

The application continues to use its existing correlated logging architecture with separate access, API, frontend, and error logs. The request correlation id is propagated through the existing request middleware and frontend request metadata.

New server events include:

- `host_account_request_created` with approval route information
- `host_account_request_review_started`
- `host_account_request_review_completed`
- `host_portal_loaded` with pending request count
- `tournament_live_leaderboard_loaded`

New frontend events include:

- `golf_course_account_request_succeeded` with approval route information
- `host_account_request_review_started`
- `host_account_request_review_completed`
- `host_account_request_review_failed`
- `host_live_leaderboard_opened`
- `live_leaderboard_view_opened`
- `live_leaderboard_refresh_started`
- `live_leaderboard_refresh_succeeded`
- `live_leaderboard_refresh_failed`
- `live_leaderboard_view_closed`

These events retain the existing shared correlation-id behavior, allowing a transaction to be traced across access, API/error, and frontend logs.

## Ports and dependencies

No server/client port behavior was changed. The server continues to obtain its listening port from `process.env.PORT`.

No dependency was added for this change. The leaderboard and account-approval implementation use existing application libraries and browser APIs.
