# Tournament flyer follow-up changes

## Changed application paths

Copy these files into the same paths in the application:

- `src/pages/TournamentPortal.tsx`
- `server/index.js`
- `test/app.test.js`

## What changed

- The tournament description now renders directly below the `Presented by` section on the public tournament flyer.
- The organizer-uploaded flyer background image now renders as a banner above the description instead of as a full translucent background behind all flyer content.
- The flyer location continues to use `hostGolfCourseAddress`, and the public tournament portal lookup now resolves that value from the `golf_courses` table using the host course name and host course state when available.
- The `Register Now` website placeholder now displays the public tournament flyer page URL (`tournament.portalUrl`) so the flyer points golfers back to the actual registration page.

## Database / migration notes

No additional schema changes were required for this follow-up. The prior `20260507_027_golf_course_address_fields` migration remains the migration needed to support `golf_courses.address` and `golf_courses.postal_code` locally and in production.

The migration runner is already wired into `npm install` through `postinstall`, so deploy by copying the files and running:

```bash
npm install
```

## Verification

Run:

```bash
npm test
npm run build
```

`npm test` passed locally with 64/64 tests. The build could not complete in this container because the local `node_modules` is missing Rollup's optional native package `@rollup/rollup-linux-x64-gnu`; rerunning `npm install` in your environment should restore that dependency before `npm run build`.
