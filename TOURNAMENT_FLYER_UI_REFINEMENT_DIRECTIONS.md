# Tournament flyer UI refinement patch

## Changed application paths

Copy these files into the same paths in the application:

- `src/pages/TournamentPortal.tsx`
- `src/pages/OrganizerTournaments.tsx`
- `test/app.test.js`

## What changed

- Moved flyer miscellaneous notes directly below the Contest Holes / Extras section.
- Renamed the flyer label from `Misc Notes` to `Tournament Information`.
- Removed the tournament description from the area directly above golfer registration.
- Renamed `Sponsor Logos` to `Sponsors`.
- Made the `Register Now` website value a clickable hyperlink to the tournament flyer page URL.
- Removed the tournament portal eyebrow, tournament name header, and `Tournament details and Golf Homiez account registration.` text from the public tournament portal page.
- Added a `Print flyer` button that prints only the `.tournament-flyer` section.
- Replaced the organizer portal published-only summary with counts by status: draft, published, completed, and cancelled.
- Removed the `Tournament workspace` eyebrow from the organizer portal page.

## Golf-course address behavior

No new schema migration is required for this patch. The existing tournament portal backend already resolves `hostGolfCourseAddress` from the `golf_courses` table through `getGolfCourseByName(courseName, courseState)` and falls back safely if a course match is unavailable.

## Validation

Run:

```bash
npm test
npm run build
```

`npm test` passed locally: 64/64.

`npm run build` could not complete in this local workspace because Rollup's optional native package `@rollup/rollup-linux-x64-gnu` is missing from `node_modules`. This is the known npm optional dependency install issue. Run `npm install` in the target app environment, then rerun `npm run build`.
