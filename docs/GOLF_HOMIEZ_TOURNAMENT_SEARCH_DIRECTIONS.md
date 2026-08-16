# GolfHomiez Tournament Search Records

## Purpose

Published GolfHomiez-hosted tournaments are synchronized into `golf_course_tournaments` so they appear in the existing **Find Tournaments** search with the same course, date, location, and tournament information as externally discovered tournaments.

## Behavior

- A host-created tournament or organizer-edited tournament is synchronized after every save.
- `published` tournaments are inserted or updated as active search records.
- `draft`, `completed`, and `cancelled` tournaments are deactivated in search.
- A published tournament must have a start date.
- GolfHomiez records sort before externally discovered tournaments.
- Search results no longer show a source line.
- Registered GolfHomiez tournament results still show a compact **Registered** indicator.
- Each result shows a **Website:** line populated from the related `golf_courses.website` value when available.
- The full search-result line opens the GolfHomiez tournament page for GolfHomiez-hosted tournaments.
- The full search-result line opens the related course website for non-GolfHomiez tournament results.
- Course-linked results include a **Course Info & Tournaments** action that opens the relative GolfHomiez course page when available.

## Scheduled discovery protection

The `getTournaments` scheduled job no longer truncates the entire table. It deletes only records whose `source_type` is not `golfhomiez`, preserving application-owned tournament records during each external crawl refresh.

## Database migration

`migration_scripts/20260806_067_golfhomiez_tournament_search_records.sql` adds:

- `source_type`
- `golfhomiez_tournament_id`
- a unique GolfHomiez tournament index
- a source/active/date search index
- a backfill for existing published tournaments with a start date

Migrations run through the existing `npm install` postinstall workflow:

```bash
npm install
```

For deployment environments that must fail when migrations cannot run:

```env
REQUIRE_DB_MIGRATIONS=true
```

## Logging

Backend synchronization and search events use the request correlation ID and are written through the existing API/access/error logging pipeline. Front-end link actions are written to `frontend.log` with the same correlation-aware logger support.

Relevant events include:

- `golfhomiez_tournament_search_record_synced`
- `user_tournament_search_started`
- `user_tournament_search_completed`
- `golfhomiez_tournament_line_item_opened`
- `golf_course_website_line_item_opened`
- `golf_course_page_opened_from_search`
## Application paths

Extract the changed-files ZIP into the GolfHomiez application root and preserve these paths:

```text
docs/GOLF_HOMIEZ_TOURNAMENT_SEARCH_DIRECTIONS.md
migration_scripts/20260806_067_golfhomiez_tournament_search_records.sql
server/index.js
server/lib/rbac.js
server/lib/tournament-discovery.js
server/migrations/index.js
src/index.css
src/lib/accounts.ts
src/pages/FindTournament.tsx
test/app.test.js
test/tournament-discovery.test.js
```

No port values or new dependencies were added.

