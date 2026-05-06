# Organizer register build fix

## Changed files

Copy these files into the matching paths in the application:

- `src/lib/accounts.ts`
- `test/app.test.js`

## What changed

- Restored the `OrganizerInviteEligibility` type export required by `src/pages/OrganizerRegister.tsx`.
- Restored the `fetchOrganizerInviteEligibility(email)` export used by organizer registration.
- Preserved the newer tournament portal client exports: `fetchOrganizerPortal`, `fetchTournamentPortal`, and `registerForTournament`.
- Preserved host tournament invite client exports from the organizer invitation flow.
- Added a regression test that verifies the organizer invite eligibility exports and tournament portal exports stay available together.

## How to apply

1. Extract this zip at the application root so the files land in the paths listed above.
2. Run `npm install` if dependencies are not already installed.
3. Run `npm test`.
4. Run `npm run build`.

## Migration

No database migration is required for this fix. It only restores missing TypeScript exports in the front-end API client.
