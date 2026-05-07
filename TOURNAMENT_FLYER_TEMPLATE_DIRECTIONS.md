# Tournament flyer template changes

## Application paths changed

Copy these files into the same paths in the deployed application:

- `src/lib/tournament-templates.ts`
- `src/components/TournamentTemplateFields.tsx`
- `src/lib/accounts.ts`
- `src/pages/HostPortal.tsx`
- `src/pages/OrganizerTournaments.tsx`
- `src/pages/TournamentPortal.tsx`
- `server/index.js`
- `server/lib/rbac.js`
- `server/migrations/index.js`
- `migration_scripts/20260507_026_tournament_flyer_template_fields.sql`
- `public/tournament-templates/classic-flyer.png`
- `test/app.test.js`

## Files to remove from the previous template implementation

The previous five uploaded flyer image templates are no longer used. Remove these files from production if they exist:

- `public/tournament-templates/classic-green.jpg`
- `public/tournament-templates/bold-contrast.jpg`
- `public/tournament-templates/blue-impact.jpg`
- `public/tournament-templates/community-care.jpg`
- `public/tournament-templates/nature-classic.jpg`

## Functionality added

- Replaced the prior five-template picker with one flyer template based on the newly uploaded flyer format.
- Added organizer-editable flyer fields:
  - Tournament Name
  - Host organization
  - Beneficiary/charity
  - Event date
  - Check-in time
  - Shotgun Start or tee times
  - Tournament format
  - Registration deadline
  - Entry fee
  - What fees include
  - Prize details
  - Hole contests/extras
  - Contact person
  - Contact phone
  - Contact email
  - Logo files, up to 18
  - Supporting Photo, used as the flyer background when supplied
  - Misc Notes
- Tournament public portal now renders the new flyer-style design and uses the supporting photo instead of the default background image when uploaded.
- Template fields are persisted as JSON in the `tournaments.template_data` column.

## Database migration

A new migration script is included:

```sql
migration_scripts/20260507_026_tournament_flyer_template_fields.sql
```

It adds:

```sql
ALTER TABLE tournaments ADD COLUMN template_data LONGTEXT NULL AFTER template_background_image_url;
```

`server/migrations/index.js` was also updated so this migration is run by the app migration runner.

## Deployment steps

1. Copy the changed files into the matching application paths.
2. Remove the obsolete previous template JPG files listed above.
3. Run:

```bash
npm install
```

The project already runs `npm run db:migrate && npm run build` during `postinstall`, so the new `template_data` column will be applied during install.

If your deployment skips lifecycle scripts, run manually:

```bash
npm run db:migrate
npm run build
```

## Verification performed

- `npm test` passed: 63 tests.
- `npm run build` passed.
