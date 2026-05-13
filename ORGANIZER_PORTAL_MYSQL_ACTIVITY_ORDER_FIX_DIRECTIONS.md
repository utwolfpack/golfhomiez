# Organizer Portal MySQL Activity Ordering Fix

## What changed

This patch fixes the organizer portal load failure in MySQL:

`Expression #1 of ORDER BY clause is not in SELECT list ... incompatible with DISTINCT`

The organizer portal tournament summary query now selects the calculated tournament activity timestamp as `activity_at` and orders by that selected alias. This keeps the requested most-recent-activity ordering while remaining compatible with MySQL `SELECT DISTINCT` rules.

The API also maps this value to `activityAt`, and the organizer portal page uses `activityAt` before falling back to `updatedAt`, `createdAt`, or `startDate`.

## Files to replace

Copy these files into the same paths in the application:

- `server/index.js`
- `src/lib/accounts.ts`
- `src/pages/OrganizerTournaments.tsx`
- `test/app.test.js`

## Database migration

No database schema changes were required for this fix.

No new migration script is included. Existing migration behavior through `npm install` remains unchanged.

## Deploy / verification steps

1. Back up the current application files listed above.
2. Copy the patched files into their matching paths.
3. Run:

   ```bash
   npm install
   npm test
   npm run build
   ```

4. Restart the application.
5. Load `/organizer/portal` and verify tournaments are displayed, ordered by most recent tournament or invite activity.

## Validation performed

- `npm test -- --runInBand` passed: 82/82 tests
- `npm run build` passed
