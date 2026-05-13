# Organizer/Host Profile Dropdown and Tournament Status Field Patch

## Changed application paths

Copy these files into the same paths in the application:

- `src/components/NavBar.tsx`
- `src/pages/OrganizerTournaments.tsx`
- `src/pages/HostPortal.tsx`
- `test/app.test.js`

## Existing profile support verified

The current patched application already includes the host and organizer profile page routes and update APIs:

- Host profile route: `/host/portal/profile`
- Organizer profile route: `/organizer/portal/profile`
- Host profile API: `GET/PUT /api/host/profile`
- Organizer profile API: `GET/PUT /api/organizer/profile`

This patch adds profile links to the collapsible account dropdown so host and organizer users can access those pages directly from navigation.

## Behavior implemented

- Moved the tournament `Status` field above the `Tournament name` field in the organizer portal tournament edit form.
- Kept the same status ordering in the host portal tournament edit form for consistency.
- Added `Host profile` and `Organizer profile` links to the collapsible account dropdown.
- Kept the existing profile update pages and correlated front-end/back-end logging flow intact.

## Migration directions

No new database schema change was required by this patch.

If your environment has not already applied the prior host/organizer profile patch, apply migration `20260513_034_host_profile_fields.sql` from the prior profile patch before using profile updates in production. The existing project migration runner is still wired to run during `npm install`.

## Verification

After copying the files, run:

```bash
npm install
npm test -- --runInBand
npm run build
```

Expected validation from this patch:

- `npm test -- --runInBand` passes.
- `npm run build` passes.
