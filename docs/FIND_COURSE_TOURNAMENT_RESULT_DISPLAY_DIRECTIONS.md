# Find Course and Find Tournament result display changes

## Summary

The golfer-facing **Find a Golf Course** and **Find a Tournament** result line items now present course contact information directly instead of using a separate `Course Info & Tournaments` button.

### Find a Golf Course

- Removes the `Course Info & Tournaments` button.
- Removes the `GolfHomiez tournaments` count line from each course result.
- Adds the golf course phone number only when it is a valid, in-service geographic phone number for one of the 50 U.S. states or Washington, DC. Invalid formats, Canadian/Caribbean NANP numbers, U.S. territory area codes, non-U.S. international numbers, toll-free/non-geographic NPAs, and missing phone numbers do not render a Phone line.
- Displays the course website on a labeled `Website:` line.
- When a published GolfHomiez course page exists, the displayed website is the complete URL for the generated page using the current application origin plus the stored page path. This means production, stage, and local environments display their own correct full URL without hardcoding a hostname.
- The entire result remains keyboard- and pointer-clickable. A course with a GolfHomiez page opens that internal page; otherwise it opens the course website when available.

### Find a Tournament

- Removes the `Course Info & Tournaments` button.
- Adds the respective golf course phone number only when it passes the same U.S. geographic phone validation; otherwise the Phone line is omitted entirely.
- When a GolfHomiez-generated course page exists, the Website line displays its complete URL using the current application origin and the generated page path.
- Tournament result click behavior is unchanged: GolfHomiez tournaments open their GolfHomiez tournament page and external results continue to use the available tournament/course target.

## Backend/data changes

No database schema change is required. The required phone fields already exist in the current schema:

- `golf_courses.phone`
- `golf_course_public_pages.contact_phone`

The golf-course search service includes course phone data in its API result. The tournament search query returns `golfCoursePhone`, preferring the published GolfHomiez course-page contact number and falling back to the golf course catalog phone number. Before either value is returned, it is normalized and validated against the in-service U.S. geographic NPA list. The list is based on the NANPA NPA Database snapshot dated August 22, 2026 and intentionally covers the 50 states plus Washington, DC only.

## Logging

The existing correlation-ID logging flow is retained.

Search-completion API logs now include counts for results that have:

- a GolfHomiez-generated public course page; and
- a phone number.

Frontend result-open events now capture whether a displayable validated U.S. phone number is present, whether the displayed website is a GolfHomiez-generated page, and the website value shown to the golfer. These events continue to use the existing request/frontend correlation IDs so transactions can be traced through the access, API, frontend, and error logs.

## Deployment

No migration was added for this change because the required columns already exist. Existing migrations continue to run through the project's `npm install`/`postinstall` process.

Apply the changed files at these paths:

- `src/pages/FindCourse.tsx`
- `src/pages/FindTournament.tsx`
- `src/lib/phone-validation.ts`
- `src/lib/accounts.ts`
- `src/index.css`
- `server/lib/golf-course-search.js`
- `server/lib/tournament-discovery.js`
- `server/lib/us-phone.js`
- `server/index.js`
- `test/find-course.test.js`
- `test/tournament-discovery.test.js`
- `docs/FIND_COURSE_TOURNAMENT_RESULT_DISPLAY_DIRECTIONS.md`

No port configuration was changed. The application continues to use its existing environment-based port configuration.
