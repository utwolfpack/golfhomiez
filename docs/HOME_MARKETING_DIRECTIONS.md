# Home Marketing and Video Library Changes

## Overview

The GolfHomiez home page is intentionally limited to the mission banner and two configurable commercial videos. The former demo-statistics dashboard remains removed. The two home video headings now link to dedicated helper-video libraries:

- Golf Homiez: `/golfhomiezvideos`
- Golf Homiez Courses: `/golfhomiezcoursevideos`

The existing home video URL defaults remain `https://youtu.be/F9CrUZWAZJA`.

## Home page

File: `src/pages/Home.tsx`

The page order is:

1. GolfHomiez Mission banner
2. Golf Homiez video — heading links to `/golfhomiezvideos`
3. Golf Homiez Courses video — heading links to `/golfhomiezcoursevideos`
4. End of page content

The mission banner continues to use background color `#c0ddc6`. `src/assets/GolfHomiezEmblem.png` is rendered to the right of the mission text in the responsive two-column banner layout.

File: `src/index.css`

The `homeMission*`, `homeVideo*`, and `marketingVideoLibrary*` styles provide responsive mobile/desktop layouts. Helper videos supplied as YouTube Shorts use a compact 9:16 frame; standard videos use 16:9.

## Helper-video pages

File: `src/pages/MarketingVideos.tsx`

Routes are registered in `src/App.tsx` before the dynamic golf-course slug routes:

- `/golfhomiezvideos` — golfer/user helper videos
- `/golfhomiezcoursevideos` — golf-course helper videos

Every helper section has a stable anchor generated from its section name. For example:

- `/golfhomiezvideos#create-a-challenge`
- `/golfhomiezcoursevideos#create-a-tournament`

The page explicitly scrolls to the matching section after asynchronous API content loads, so these links can be used from buttons, help links, instructions, or other locations throughout the GolfHomiez application.

## Default helper videos

Migration `20260825_081` seeds the requested default sections with:

`https://www.youtube.com/shorts/Tj2D1R2rsSU?feature=share`

Golf Homiez Users:

- Create a Golf Homiez Account
- Create a team and register for a tournament
- Create a challenge
- Log a round

Golf Homiez Courses:

- Manage Your Golf Homiez Website
- Create a Tournament
- Manage your Golf Homiez Golf Course Account

Administrators can delete any seeded section after the migration has been applied. The migration is recorded once by the existing migration framework, so deleting a section later does not cause it to be recreated on future installs.

## Marketing admin page

File: `src/pages/AdminPortal.tsx`

Open `/golfadmin`, sign in as an admin, and select **Marketing**. The page now contains two groups of controls.

**Home page videos** keeps the existing configurable URLs:

- Golf Homiez YouTube URL
- Golf Homiez Courses YouTube URL

**Helper video sections** allows an administrator to:

- Choose **Golf Homiez Users** or **Golf Homiez Courses**.
- Enter a section name.
- Enter a YouTube URL.
- Add the section.
- See the generated relative link.
- Open the helper-video page or a specific helper-video section.
- Delete a section.

Only validated YouTube URLs are accepted. Duplicate section names are allowed; GolfHomiez generates a unique anchor suffix when necessary so every helper link remains addressable.

## APIs and data source

Client API: `src/lib/marketing.ts`

Server implementation: `server/lib/marketing-settings.js`

Public endpoints:

- `GET /api/marketing/home`
- `GET /api/marketing/videos?audience=golf_homiez`
- `GET /api/marketing/videos?audience=golf_homiez_courses`

Admin endpoints:

- `GET /api/admin/marketing/home`
- `PUT /api/admin/marketing/home`
- `GET /api/admin/marketing/videos`
- `POST /api/admin/marketing/videos`
- `DELETE /api/admin/marketing/videos/:sectionId`

The admin endpoints use the existing admin-session middleware.

## Database migrations

Marketing configuration migration:

- `migration_scripts/20260825_079_home_marketing_settings.sql`

Homepage demo cleanup migration:

- `migration_scripts/20260825_080_remove_homepage_demo_data.sql`

Helper-video migration:

- `migration_scripts/20260825_081_marketing_video_sections.sql`

Migration registration:

- `server/migrations/index.js`

Migration `081` creates `marketing_video_sections` with audience, section name, YouTube URL, generated section slug, display order, admin/audit metadata, correlation ID, timestamps, and indexes. It also seeds the seven requested default sections.

The existing `package.json` `postinstall` command runs `npm run db:migrate`, so the registered migrations are applied during normal `npm install` deployment in development, stage, and production environments. Set `REQUIRE_DB_MIGRATIONS=true` in environments where installation must fail instead of skipping when the database is unavailable.

## Logging and correlation IDs

No additional logging dependency was added. The existing infrastructure continues to write:

- `logging/access.log` — HTTP request/response lifecycle
- `logging/api.log` — helper-video reads, creates, deletes, and home-video configuration
- `logging/error.log` — API failures and validation failures
- `logging/frontend.log` — home links, helper-page loads, video loads, deep links, and admin Marketing actions

`X-Correlation-Id` continues to bind browser, access, API, and error logging into the same transaction lifecycle.

## Removed homepage demo code

The previous cleanup remains in effect. Existing deployments should not contain:

- `src/lib/dashboardSample.ts`
- `server/scripts/seed-homepage-demo.js`

## Validation and dependencies

Coverage is maintained in `test/home-marketing.test.js`. The tests verify the two new routes, home-page links, deep-link scrolling, admin add/delete controls, public/admin APIs, YouTube Shorts validation, stable relative-link generation, migration registration, all seven seeded sections, and correlation-aware logging integration.

No new npm dependencies are required for this feature.
