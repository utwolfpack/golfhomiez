# Tournament Flyer Uploaded Asset Template Changes

## Changed application paths

- `public/tournament-templates/tournament-flyer-background.png`
  - New default flyer background image from the uploaded golf course background.
- `public/tournament-templates/tournament-detail-lines.png`
  - New tournament information line-art image from the uploaded detail-line screenshot.
- `src/lib/tournament-templates.ts`
  - Points the tournament flyer template at the new uploaded background image and detail-line image.
  - Adds `detailLinesImageUrl` to the template metadata.
- `src/components/TournamentTemplateFields.tsx`
  - Updates the organizer template preview to show the new uploaded background with the detail-line artwork overlay.
  - Keeps the existing supporting photo upload capability so organizers can replace the default background.
- `src/pages/TournamentPortal.tsx`
  - Renders the public tournament page using the uploaded background image.
  - Uses the uploaded detail-line artwork for the six main tournament information rows and overlays organizer-entered values on those lines.
- `test/app.test.js`
  - Adds assertions covering the uploaded background image, uploaded detail-line image, template metadata, and public portal rendering.

## Production deployment

1. Copy the changed files above into the same paths in the application.
2. Run `npm install` as part of the normal deployment. Existing migration auto-run behavior remains unchanged.
3. Run `npm test`.
4. Run `npm run build`.
5. Deploy/restart the application.

## Database migrations

No database schema changes were required for this request. The previous tournament template fields and uploaded image data fields continue to support this change.

## Verification performed

- `npm test` passed: 63 tests.
- `npm run build` passed.
