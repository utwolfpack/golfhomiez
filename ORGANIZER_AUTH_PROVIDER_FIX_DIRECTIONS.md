# Organizer Auth Provider Render Fix

## Changed files

- `src/App.tsx`
- `src/context/OrganizerAuthContext.tsx`
- `test/app.test.js`

## Application paths affected

- `/organizer/portal`
- `/organizer/register`
- `/tournaments/:id`
- Shared application routing in `src/App.tsx`

## What changed

- Added `OrganizerAuthProvider` to the top-level provider stack in `src/App.tsx`, inside `AdminAuthProvider` and outside the routed pages.
- Added `src/context/OrganizerAuthContext.tsx` so organizer-aware components have a provider-backed `useOrganizerAuth()` hook.
- Added a regression test that verifies routed pages are wrapped by `OrganizerAuthProvider` before rendering.

## How to apply

Copy these files into the application root, preserving paths:

```text
src/App.tsx
src/context/OrganizerAuthContext.tsx
test/app.test.js
```

Then run:

```bash
npm test
npm run build
npm run dev
```

## Migration instructions

No database schema changes are included in this fix. No migration script is required.
