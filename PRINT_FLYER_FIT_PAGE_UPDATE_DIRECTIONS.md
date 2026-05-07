# Print Flyer Fit-to-One-Page Update

## Changed files

- `src/pages/TournamentPortal.tsx`
- `test/app.test.js`

## Install directions

Copy these files into the same paths in the application.

## Verification

Run:

```bash
npm test
npm run build
```

Then open a tournament flyer and click **Print flyer**. The print-only CSS now uses a smaller scale, narrower print margins, shorter banner height, tighter row spacing, and compressed lower-section spacing so the beneficiary and sponsors sections fit on one printed page.

## Database migration

No database migration is required.
