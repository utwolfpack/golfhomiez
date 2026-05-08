# Organizer registration email-required fix

## Root cause
Stage organizer registration was failing on `POST /api/organizer/register` because `organizer_role_accounts.email` is a required column in the stage database, but the organizer-account upsert path inserted an auto-created organizer account without including `email`.

The logs showed:

```text
Field 'email' doesn't have a default value
at upsertOrganizerAccount (.../server/lib/rbac.js:775:14)
```

## Fix
`server/lib/rbac.js` now detects available `organizer_role_accounts` columns and builds the insert dynamically. When the stage schema has `email`, the insert includes the normalized organizer email. This keeps compatibility with schemas that have direct organizer columns and schemas that rely on role assignments.

## Migration
No new migration is required for this error. The stage schema already has the required `email` column; the issue was that the application was not writing to it.

This package still includes the existing registered migrations through `20260508_030` so the target environment remains aligned when `npm install` runs.

## Deployment
From the app root:

```bash
unzip organizer_registration_email_required_fix_changes.zip -d /path/to/golfhomiez
cd /path/to/golfhomiez
npm install
```

`npm install` runs the registered migration process through `postinstall`.

## Validation
1. Load the organizer invite link.
2. Complete organizer registration.
3. Confirm `POST /api/organizer/register` returns success.
4. Confirm the organizer can reach the organizer portal for the invited tournament.
5. Run:

```bash
npm test
```
