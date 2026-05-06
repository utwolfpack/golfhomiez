# Organizer Auth Export Fix Directions

## Changed files

- `server/lib/organizer-auth.js`
- `test/app.test.js`

## What changed

- Restored the named server export `getOrganizerAuthAccountByEmail` expected by `server/lib/rbac.js`.
- The compatibility export delegates to the isolated organizer-auth account lookup so organizer accounts remain separate from GolfHomiez user and host accounts.
- Added a regression test to verify the expected export remains present.

## How to apply

1. Copy the files from this zip into the matching paths in the app.
2. Restart the dev server.
3. Run:

```bash
npm test
npm run build
npm run dev
```

## Migration

No database migration is required for this fix.
