# Organizer login runtime fix

## Diagnosis

The uploaded logs show `/organizer/login` rendered successfully, then the browser reported an unhandled rejection: `h is not a function`. The access/API logs did not show an organizer sign-in request for those failures, which indicates the client-side organizer login handler failed while handling the error path before the original failure could be surfaced.

## Changed files

- `src/pages/OrganizerLogin.tsx`
  - Uses the full auth object instead of destructuring `logout` into a minified local function.
  - Guards cleanup logout with `typeof auth.logout === 'function'` so organizer login failures are not replaced by `h is not a function`.
  - Adds front-end transaction logs for organizer login success, organizer login failure, and cleanup logout failure. These logs use the existing correlation-id logging pipeline.

- `test/app.test.js`
  - Adds a regression test for the organizer login failure path.
  - Fixes stale/broken regex assertions so the maintained test suite runs successfully.

## How to apply

Copy the files from this zip into the same paths in your application:

```text
src/pages/OrganizerLogin.tsx
.../test/app.test.js
```

Then run:

```bash
npm test
npm run build
```

No database migration is required for this change.
