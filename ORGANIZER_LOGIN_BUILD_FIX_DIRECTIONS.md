# Organizer login build fix

## Changed files
- `src/lib/accounts.ts` — restores the missing `OrganizerPortalSummary` type and `fetchOrganizerPortal()` export used by `src/pages/OrganizerLogin.tsx`.
- `test/app.test.js` — adds a regression assertion that the organizer portal API client export exists.

## How to apply
1. From the application root, copy the files in this zip over the same paths in your application.
2. Run `npm install` if Rollup/Vite optional dependencies are missing locally.
3. Run `npm run build`.

## Migration
No database migration is required for this build-only fix.

## Verification
This fixes the Rollup error:

```text
"fetchOrganizerPortal" is not exported by "src/lib/accounts.ts"
```

I attempted to verify in the provided archive. The code-level export/import issue is fixed, but the container build could not complete because the extracted `node_modules` is missing Rollup's optional native package `@rollup/rollup-linux-x64-gnu`. The existing test suite also has a pre-existing invalid regex at `test/app.test.js:451`, unrelated to this change.
