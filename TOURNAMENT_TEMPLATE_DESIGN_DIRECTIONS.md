# Tournament Template Design Changes

## Changed application paths
- `src/lib/tournament-templates.ts` — defines the five tournament page template options and default background image paths.
- `src/components/TournamentTemplateFields.tsx` — shared organizer/host UI for selecting templates and uploading a custom background image.
- `src/pages/HostPortal.tsx` — adds template selection and custom background upload when creating or modifying host-created tournaments.
- `src/pages/OrganizerTournaments.tsx` — adds template selection and custom background upload when organizers modify invited tournaments.
- `src/pages/TournamentPortal.tsx` — applies the selected template and background image to the public tournament page.
- `src/lib/accounts.ts` — adds template fields to tournament input and response types.
- `server/lib/rbac.js` — persists template selections and custom background URLs during tournament creation.
- `server/index.js` — returns template fields from tournament APIs and persists template changes during updates.
- `server/migrations/index.js` — registers the production schema migration with the npm install migration runner.
- `migration_scripts/20260507_025_tournament_page_templates.sql` — production migration for template storage fields.
- `public/tournament-templates/*.jpg` — five default template background images based on the provided examples.
- `test/app.test.js` — adds coverage for selectable templates, custom background upload support, API persistence, and the migration.

## Production deployment directions
1. Back up the production database.
2. Deploy the changed files.
3. Run `npm install`. The existing `postinstall` script runs `npm run db:migrate && npm run build`, so the new migration will be applied automatically.
4. If migrations are run separately in your environment, run `npm run db:migrate` before starting the server.
5. Restart the application.

## Schema changes
The migration adds these columns to `tournaments`:
- `template_key VARCHAR(64) NULL`
- `template_background_image_url LONGTEXT NULL`

It also adds:
- `idx_tournaments_template_key` on `tournaments(template_key)`

## Verification performed
- `npm test` passed: 63 tests.
- `npm run build` passed.
