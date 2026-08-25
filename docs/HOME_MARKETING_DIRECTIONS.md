# Home Marketing and Mission Changes

## Overview

The home page is now intentionally limited to the GolfHomiez mission banner and the two configurable commercial videos. The former demo-statistics/score-dashboard section has been removed, including its guest sample data and local homepage demo seeder.

Default video URL for both sections:

- `https://youtu.be/F9CrUZWAZJA`

## Home page

File: `src/pages/Home.tsx`

The page order is now:

1. GolfHomiez Mission banner
2. Golf Homiez video
3. Golf Homiez Courses video
4. End of page content

Nothing from the former score/statistics dashboard is rendered below the Golf Homiez Courses video.

The mission banner uses background color `#c0ddc6`. The existing `src/assets/GolfHomiezEmblem.png` is rendered as a separate image to the right of the mission text instead of as a CSS background. The banner uses a responsive two-column layout so the mission text and emblem remain horizontally parallel; the text column can shrink and wrap as needed without overlaying the image. The mobile layout retains side-by-side placement with a smaller reserved image column.

File: `src/index.css`

The `homeMission*` and `homeVideo*` styles provide the responsive banner and 16:9 embedded video layout for mobile and desktop browsers.

## Removed homepage demo code

The following obsolete homepage-only files must be deleted from existing deployments when applying these changes:

- `src/lib/dashboardSample.ts`
- `server/scripts/seed-homepage-demo.js`

`package.json` no longer contains the `seed:homepage-demo` command. General development/demo population utilities used elsewhere in the application are unchanged.

## Marketing admin page

File: `src/pages/AdminPortal.tsx`

Open `/golfadmin`, sign in as an admin, and select **Marketing** in the admin navigation. The page contains:

- Golf Homiez YouTube URL
- Golf Homiez Courses YouTube URL
- Save home videos

Only validated YouTube URLs are accepted.

Client API file: `src/lib/marketing.ts`

Endpoints:

- Public home settings: `GET /api/marketing/home`
- Admin settings: `GET /api/admin/marketing/home`
- Admin update: `PUT /api/admin/marketing/home`

The admin endpoints require the existing admin session middleware.

## Database migrations

Marketing configuration migration:

- `migration_scripts/20260825_079_home_marketing_settings.sql`

Homepage demo cleanup migration:

- `migration_scripts/20260825_080_remove_homepage_demo_data.sql`

Migration registration:

- `server/migrations/index.js`

Migration `20260825_080` removes records created by the retired homepage demo seeder for `thegolfhomie@example.com`, including its demo scores and the seeded `Homie Hustlers` membership/team when the team is left empty. It also removes the seeded demo auth user.

The existing `package.json` `postinstall` command runs `npm run db:migrate`, so both migrations are automatically considered during `npm install` in development, stage, and production environments. Set `REQUIRE_DB_MIGRATIONS=true` in environments where installation must fail instead of skipping when the database is unavailable.

## Logging and correlation IDs

No additional logging dependency was introduced. The implementation uses the existing logging infrastructure:

- `logging/access.log` — HTTP request/response lifecycle
- `logging/api.log` — marketing API reads and updates
- `logging/error.log` — API failures and validation warnings/errors
- `logging/frontend.log` — home banner/video/config activity and admin Marketing actions

The existing `X-Correlation-Id` flow binds browser logging, API logging, access logging, and errors to the same transaction ID.

## Validation

Coverage is in `test/home-marketing.test.js` plus the maintained application tests. Tests verify that the demo statistics dashboard is absent, obsolete guest/seeder code is removed, the cleanup migration is registered, the new banner color/image placement is present, videos remain responsive, admin Marketing configuration still works, and correlation-aware logging remains wired.

No new npm dependencies were added for these changes.
