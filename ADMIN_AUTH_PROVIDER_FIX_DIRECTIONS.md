# AdminAuthProvider render fix

## Changed files

Copy these files into the application at the same relative paths:

- `src/App.tsx`
- `test/app.test.js`

## What changed

`src/components/NavBar.tsx` and `src/pages/AdminPortal.tsx` call `useAdminAuth()`. The application was rendering `NavBar` outside of `AdminAuthProvider`, which caused the app-level render crash:

`Uncaught Error: useAdminAuth must be used within AdminAuthProvider`

`src/App.tsx` now imports `AdminAuthProvider` and wraps the rendered routes/navigation with it, inside the existing `AuthProvider` and around the existing `HostAuthProvider`.

## Test coverage

`test/app.test.js` now includes a regression test verifying that `App.tsx` imports `AdminAuthProvider` and wraps `NavBar` and `/golfadmin` within it.

## Migration scripts

No database schema changes were required for this fix. No migration script is needed.

## Verification

After copying the files:

```bash
npm test
npm run build
npm run dev
```

Then open the app and verify the page renders without the `useAdminAuth` provider error.
