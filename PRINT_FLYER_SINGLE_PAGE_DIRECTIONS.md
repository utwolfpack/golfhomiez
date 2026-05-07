# Print Flyer Single Page Patch

## Changed files

- `src/pages/TournamentPortal.tsx`
- `test/app.test.js`

## Application paths

- Tournament flyer page: `src/pages/TournamentPortal.tsx`
- Flyer print button: `src/pages/TournamentPortal.tsx`
- Regression tests: `test/app.test.js`

## What changed

The flyer print stylesheet now targets letter portrait output, hides non-flyer content, scales only the tournament flyer content, tightens print-only spacing, and prevents page overflow so the printed flyer fits on a single page. The browser view is unchanged.

## Validation

Run:

```bash
npm test
npm run build
```

No database migration is required.
