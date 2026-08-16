# Golfadmin portal organization

## Deployment paths

Copy the changed files to these paths in the GolfHomiez application:

- `src/pages/AdminPortal.tsx`
- `src/lib/admin.ts`
- `src/index.css`
- `server/lib/admin-portal.js`
- `server/lib/external-api-metrics.js`
- `server/index.js`
- `test/app.test.js`
- `docs/GOLFADMIN_PORTAL_ORGANIZATION_DIRECTIONS.md`

## Portal pages

The authenticated `/golfadmin` portal is separated into four focused pages. `Golf` is the default after admin login and after sign-out/sign-in transitions.

- **Golf**: users, verified users, teams, rounds/scores, tournaments, total challenges, active challenges, completed challenges, and recent user/team metadata.
- **Tournaments**: tournament totals and status, host accounts, validated hosts, organizers, hosts with tournaments, registrations, tournaments with registrations, scored tournament teams, and host/organizer metadata.
- **API Usage**: external API call total, successful calls, failed calls, success rate, average latency, distinct endpoints, provider totals, endpoint totals, and date/provider/endpoint filters.
- **Admin**: admin-user totals, active admins, pending golf-course account requests, the current admin identity, request approvals/deletion, admin-user creation/deletion, and access to Scheduled Jobs.

## Data sources

The new metrics use existing application tables and therefore do not create duplicate analytics data. The portal reads from the existing Better Auth `user` table, `app_users`, `teams`, `scores`, `tournaments`, `host_accounts`, `organizer_role_accounts`, `host_account_requests`, `inbox_messages`, `tournament_registrations`, `tournament_team_scores`, and `external_api_call_metrics` where those optional tables are available.

Challenge totals are counted by unique challenge thread when `thread_id` is available so multi-message challenge threads are not counted as separate challenges.

## Database migrations

**No database schema migration is required for this change.** All metrics are derived from existing schema. The existing `package.json` `postinstall` flow remains responsible for running `npm run db:migrate` before the production build, so other development/stage/production environments continue to receive any previously registered migrations automatically.

## Logging and correlation IDs

The existing logging architecture remains in use rather than introducing another logger. HTTP requests continue through access logging and request correlation middleware, API operations continue to `api.log`, and browser events continue to `frontend.log` with the same request/frontend correlation mechanism.

New diagnostics include:

- `admin_portal_page_selected` in frontend logging for Golf, Tournaments, API Usage, and Admin navigation.
- `admin_portal_metadata_loaded` with the expanded portal summary, including golf, tournament, host, challenge, and admin metrics.
- `admin_external_api_call_metrics_loaded` with total calls, successes, failures, success rate, average latency, distinct endpoint count, row count, filters, and generated time.

Search the same correlation ID across `logging/access.log`, `logging/api.log`, `logging/frontend.log`, and `logging/error.log` to trace a request lifecycle.

## Security and dependencies

No dependency was added for this implementation. Run the normal security checks before deployment:

```bash
npm test
npm audit --audit-level=high
```

The change does not alter application ports. Server port behavior continues to use the existing environment configuration rather than hardcoded port values.
