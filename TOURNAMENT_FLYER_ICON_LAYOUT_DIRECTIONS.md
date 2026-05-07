# Tournament Flyer Icon Layout Changes

## Changed application files

Copy these files into the same paths in the application:

- `src/lib/tournament-templates.ts`
  - Replaces the old background/detail-line image template metadata with uploaded icon assets for the tournament attribute rows.
  - Keeps the single `classic-flyer` template and the organizer-populated flyer fields.

- `src/components/TournamentTemplateFields.tsx`
  - Updates the organizer template picker preview so it no longer uses the old background/detail-line artwork.
  - Shows the clean flyer template structure with uploaded attribute icons.
  - Keeps optional supporting photo and up-to-18 sponsor logo upload support.

- `src/pages/TournamentPortal.tsx`
  - Rebuilds the tournament flyer display to match the clean white flyer layout.
  - Uses the uploaded icons for Date, Tee Time / Check-In, Course / Venue, Location, Format, and Registration Fee.
  - Removes the previous background-image/detail-line panel from the displayed flyer.
  - Keeps friendly user-local date formatting and the existing close button back to `/my-tournaments`.

- `test/app.test.js`
  - Updates coverage to verify the new icon-based flyer metadata and clean attribute row layout.
  - Verifies the old background/detail-line template assets are no longer referenced by the flyer code.

## New static asset files

Copy these files into `public/tournament-templates/`:

- `public/tournament-templates/date.jpg`
- `public/tournament-templates/tee-time.jpg`
- `public/tournament-templates/golf-course.jpg`
- `public/tournament-templates/location.png`
- `public/tournament-templates/format.jpg`
- `public/tournament-templates/registration-fee.jpg`

## Files that can be removed from the deployed app

These old template files are no longer referenced by the app and can be deleted after deploying the replacement files:

- `public/tournament-templates/tournament-flyer-background.png`
- `public/tournament-templates/tournament-detail-lines.png`

## Database migrations

No schema changes were required for this update. No new migration script is needed.

## Validation

Run from the application root:

```bash
npm install
npm test
npm run build
```

The validated local run passed:

- `npm test`: 63 tests passed
- `npm run build`: passed
