# Golf-Course Public Page Directions

## Overview

Approving a pending golf-course host account in the Golf Admin portal now creates a persistent public GolfHomiez page for the approved course. The approval process links the host account to the selected `golf_courses` record, reads the course website when it is publicly reachable, and creates the public page from the available course catalog and website metadata.

The public URL is built from the golf-course name followed by the two-letter state abbreviation, with punctuation and spaces removed and the result converted to lowercase. For example:

- `Murray Parkway` in Utah becomes `/murrayparkwayut`.
- When that slug is already used, the next page becomes `/murrayparkwayut2`, then `/murrayparkwayut3`, and so on.

The slug is stored in the database and is not changed when a host later edits the golf-course name.

## Approval workflow

1. A host requester selects a course from the database-backed golf-course catalog. The request now stores both the course name and `golf_course_id`.
2. An administrator approves the request from `/golfadmin`.
3. The server creates or updates the host account and associates it with the selected golf-course record.
4. The server creates `golf_course_public_pages` content using:
   - the course name, phone, address, city, state, postal code, and website from `golf_courses`;
   - the website Open Graph or standard description metadata for the course summary when available;
   - the website Open Graph or Twitter image metadata for the banner when available;
   - a catalog-based fallback summary when the website is unavailable or does not expose a description.
5. The approval response includes the new public page path and URL. Correlated approval and page-creation events are written to the access, API, error, and frontend logs as applicable.

Website retrieval is limited to HTTP and HTTPS public-network destinations. Localhost, private-network addresses, oversized responses, unsupported content types, excessive redirects, and slow responses are rejected. Website retrieval failures do not prevent host approval; the page is created from catalog data and the failure is recorded in `logging/error.log` with the shared correlation ID.

## Public page contents

The root-level route `/:golfCourseSlug` displays:

- the course name and location;
- a banner image when configured;
- a course summary;
- public phone and address information;
- a link to the course website;
- the number of public GolfHomiez tournaments hosted by the course;
- links to each published/public tournament page.

The supporting API route is:

```text
GET /api/golf-course-pages/:slug
```

Only pages with `is_published = 1` are returned publicly. Tournament results exclude cancelled and deleted records and only include public or published tournaments.

## Host profile maintenance

An authenticated host can edit the page from:

```text
/host/portal/profile
```

The profile contains fields for:

- golf-course name;
- course summary;
- banner image URL;
- course website URL;
- public contact phone;
- street address;
- city;
- state abbreviation;
- postal code;
- published/unpublished status.

The permanent page URL is displayed read-only with a preview button. Account contact details and internal notes remain separate from the public page fields.

Existing approved host accounts without a public page are backfilled the first time the host profile is loaded or saved, using the linked course ID when available and a catalog name match as a compatibility fallback.

## Database migration

The migration is:

```text
migration_scripts/20260804_066_golf_course_public_pages.sql
```

It adds `golf_course_id` to `host_accounts` and `host_account_requests`, adds supporting indexes, and creates `golf_course_public_pages` with unique host-account and slug indexes.

The migration is also registered as `20260804_066` in `server/migrations/index.js`. The existing `postinstall` script runs `npm run db:migrate`, so `npm install` applies the schema changes in other development, stage, and production environments when database access is available. Set `REQUIRE_DB_MIGRATIONS=true` in environments where installation must fail when migration execution cannot reach the database.

## Logging

The feature uses the existing `X-Correlation-Id` transaction lifecycle:

- `logging/access.log`: HTTP request completion, status, and duration;
- `logging/api.log`: approval, page creation/backfill, page load, profile load, and profile update events;
- `logging/frontend.log`: public page load and host profile load/save events;
- `logging/error.log`: website metadata retrieval failures and route errors.

Useful event names include:

- `golf_course_public_page_source_loaded`
- `golf_course_public_page_source_load_failed`
- `golf_course_public_page_created`
- `golf_course_public_page_backfilled`
- `golf_course_public_page_loaded`
- `golf_course_public_page_not_found`
- `golf_course_public_page_updated`
