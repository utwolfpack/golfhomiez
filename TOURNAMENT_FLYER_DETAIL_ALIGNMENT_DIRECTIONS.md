# Tournament Flyer Detail Alignment Update

## Changed files

- `src/pages/TournamentPortal.tsx`
  - Enlarges the flyer detail image panel while preserving the uploaded image asset.
  - Keeps the label/icon artwork intact and overlays organizer-entered values farther to the right so values line up with the existing label/divider area.
  - Uses responsive font sizing, stronger weight, line-height, clipping, and text shadow so populated values are easier to read over the image.

- `test/app.test.js`
  - Adds assertions that the tournament flyer detail panel uses the fixed uploaded-image aspect ratio, the aligned value column, and the responsive readable font sizing.

## Application paths affected

- Public tournament page: `/tournaments/:id`
- Organizer/host tournament pages that preview or publish the flyer continue using the existing template fields and uploaded-image template assets.

## Deployment directions

1. Copy the changed files from this zip into the same paths in the application.
2. Confirm the previously added template assets are present in production:
   - `public/tournament-templates/tournament-flyer-background.png`
   - `public/tournament-templates/tournament-detail-lines.png`
3. Install dependencies and run migrations through the existing install process:
   - `npm install`
4. Validate the change:
   - `npm test`
   - `npm run build`
5. Deploy the application using the normal production deployment process.

## Database and migration notes

No schema changes were made for this request, so no new migration script is required.
