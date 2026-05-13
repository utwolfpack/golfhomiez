# Tournament flyer icon and print layout patch

## Changed files and application paths

Copy these files into the same paths in the application:

- `public/tournament-templates/TourneyBannerDefault.png`
  - Replaces the default tournament banner artwork with a version that does not contain the Golf Homiez icon inside the banner image.
- `src/pages/TournamentPortal.tsx`
  - Renders the Golf Homiez icon as a flyer-level overlay at the flyer container's top-right corner when the default banner is used.
  - Updates print-only CSS to print only the flyer, force a desktop/non-mobile layout, and keep the printed flyer constrained to one letter-size page.
- `src/index.css`
  - Restricts tournament mobile flyer rules to screen media only so they do not apply during printing.
  - Keeps mobile screen rendering responsive while allowing print rules to use the desktop flyer grid layout.
- `test/app.test.js`
  - Adds/updates source-level regression coverage for the flyer-level icon placement and print-only desktop layout rules.

## Database migrations

No database schema changes were required for this patch.

No new migration script is included. The existing migration process remains unchanged and continues to run during `npm install` through the existing `postinstall` script.

## Deployment steps

1. Back up the existing application files.
2. Copy the changed files above into their matching paths in the application.
3. Install dependencies and run existing migrations/build:

   ```bash
   npm install
   ```

   The application already runs database migrations and the production build from `postinstall`.

4. Verify locally:

   ```bash
   npm test
   npm run build
   ```

5. Open a tournament using the default banner and verify:

   - The default banner itself does not contain the Golf Homiez icon.
   - The Golf Homiez icon appears at the top-right of the overall flyer, not the top-right of the banner image.
   - Clicking `Print flyer` prints only the flyer.
   - The print preview uses the non-mobile/desktop flyer layout and fits on one letter-size page.

## Validation performed

- `npm test` passed: 79/79 tests.
- `npm run build` passed.
