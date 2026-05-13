# Organizer/Host profile, tournament edit, and printable flyer changes

## Files included in this patch

Copy these files into the same paths in the application:

- `server/index.js`
- `server/lib/host-auth.js`
- `server/migrations/index.js`
- `migration_scripts/20260513_034_host_profile_fields.sql`
- `src/App.tsx`
- `src/components/TournamentTemplateFields.tsx`
- `src/lib/accounts.ts`
- `src/lib/host-auth.ts`
- `src/pages/HostPortal.tsx`
- `src/pages/HostProfile.tsx`
- `src/pages/OrganizerProfile.tsx`
- `src/pages/OrganizerTournaments.tsx`
- `src/pages/TournamentPortal.tsx`
- `public/tournament-templates/TourneyBannerDefault.png`
- `test/app.test.js`

## What changed

- Moved the registration deadline field below the tournament date field when hosts or organizers edit a tournament.
- Added `/host/portal/profile` for host profile updates.
- Added `/organizer/portal/profile` for organizer profile updates.
- Added profile update API routes for host and organizer accounts.
- Added editable host profile fields to `host_accounts`: `contact_name`, `phone`, `website_url`, and `notes`.
- Organizer portal tournament cards are sorted by the most recent tournament or invite activity first.
- Organizer portal tournament descriptions are hidden on the list cards and only shown in the modify/edit form.
- The public tournament print action now prints a dedicated one-page, non-mobile, bulletin-board flyer layout instead of printing the responsive screen layout.
- The Golf Homiez emblem is rendered in the top-right corner of the flyer container and is not embedded in the default banner image.

## Migration deployment

A new migration is included:

- `migration_scripts/20260513_034_host_profile_fields.sql`

The app already runs migrations during install through:

```bash
npm install
```

That runs the existing postinstall chain:

```bash
npm run db:migrate && npm run build
```

For production deployment:

1. Back up the production database.
2. Copy this patch into the application root.
3. Ensure production database environment variables are set.
4. Run:

```bash
npm install
```

Or, to run only the database migration after copying the files:

```bash
npm run db:migrate
```

The migration runner checks for the host profile columns before adding them, so the migration can be applied safely in another development environment that may already have some of the columns.

## Verification

The following checks were run successfully after these changes:

```bash
npm test
npm run build
node --check server/index.js
node --check server/lib/host-auth.js
node --check server/migrations/index.js
```

Results:

- `npm test`: 82/82 tests passed
- `npm run build`: passed
