# Organizer Forgot Password Link Update

## Changed files

- `src/pages/OrganizerLogin.tsx`
  - Changed the organizer forgot-password action from a secondary button to a small text link, matching the pattern used on `src/pages/HostLogin.tsx`.
  - The link still routes to `/organizer/forgot-password`.

- `test/app.test.js`
  - Updated the organizer login password-reset test to verify the forgot-password action is rendered as a small text link instead of a `.btn` button.
  - Keeps the existing assertions that organizer account creation remains hidden and the reset routes/backend are still wired.

## Application paths affected

- UI route: `/organizer/login`
- Reset request route linked from the login page: `/organizer/forgot-password`

## Deployment directions

1. Extract this ZIP into the application root so the included paths overwrite the existing files.
2. Run tests:
   ```bash
   npm test -- --test-reporter=spec
   ```
3. Build the application:
   ```bash
   npm run build
   ```
4. Deploy/restart the Node application using your normal process.

## Migration directions

No database schema changes were made for this UI-only update, so no new migration script is required.

The existing migration process remains unchanged. In environments using the app's `postinstall` script, `npm install` still runs:

```bash
npm run db:migrate && npm run build
```

## Verification completed

- `node --check server/index.js`
- `npm test -- --test-reporter=spec` — 94 passed
- `npm run build` — passed
