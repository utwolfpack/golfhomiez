# Tournament Flyer Template Selection

## Summary

This change adds four additional tournament flyer layouts while preserving the existing Classic Golf Homiez flyer. Hosts and organizers can select among five flyer templates without creating any new tournament data fields. The selected layout is stored in the existing `tournaments.template_key` column and all flyer content continues to use the existing tournament and `template_data` fields.

The four uploaded example flyer images were used as visual design guides only. They are not copied into the application, so example organization names, logos, people, phone numbers, dates, and other third-party content are not shipped with GolfHomiez.

## Available templates

- Classic Golf Homiez (`classic-flyer`)
- Fairway Poster (`fairway-poster`)
- Modern Golf Open (`modern-open`)
- Charity & Memorial (`charity-tribute`)
- Sunset Drive (`sunset-drive`)

## Host and organizer workflow

The flyer-template selector is rendered directly below the Charity Image field in `TournamentTemplateFields`.

Changing templates only updates `templateKey`. It does not clear or replace any existing tournament content. A user can switch repeatedly between templates while editing and then save the tournament normally.

Both of these flows use the same selector:

- Host tournament creation and editing in `/host/portal`
- Organizer tournament editing

The public tournament page reads the saved `template_key` and renders the corresponding flyer layout. The print flyer also receives a template-specific print treatment.

## Existing data used by all templates

The layouts use only existing fields, including:

- Tournament name
- Tournament description
- Start date
- Host golf-course / organization
- Flyer background image
- Charity image
- Beneficiary / charity name
- Charity message
- Location
- Check-in time
- Tee time
- Tournament format
- Registration fee
- Included items
- Prizes / awards
- Hole contests / extras
- Contact person
- Contact phone
- Contact email
- Miscellaneous notes
- Sponsor availability
- Sponsor logos
- Existing tournament public URL / QR code

No new content fields were created solely to imitate the supplied reference flyers. If a reference design contained information that does not exist in GolfHomiez, that information is omitted.

## Backend validation

The host and organizer tournament sanitizers now accept these persisted template keys:

```text
classic-flyer
fairway-poster
modern-open
charity-tribute
sunset-drive
```

Unknown template keys continue to return the existing friendly validation error.

## Logging

The template selector writes a correlated frontend event:

```text
tournament_flyer_template_selected
```

The public flyer logs correlated image/QR lifecycle events for the additional templates:

```text
tournament_template_banner_loaded
tournament_template_banner_load_failed
tournament_template_charity_image_loaded
tournament_template_charity_image_load_failed
tournament_template_qr_code_loaded
tournament_template_qr_code_load_failed
```

Host and organizer tournament update logs now include `templateKey`, and host tournament creation logging records the selected template as well. These events continue to use the application's existing correlation ID and access/API/frontend/error logging infrastructure.

## Database migration

No schema migration is required for this change. The project already has the `tournaments.template_key` column and index from the existing tournament-template migrations, so the additional values can be stored without modifying the schema.

The existing `npm install` postinstall flow remains unchanged and continues to execute registered migrations before the production build:

```text
npm run cleanup:project-files && npm run db:migrate && npm run build
```

For stage and production environments, continue to use:

```env
REQUIRE_DB_MIGRATIONS=true
```

## Changed files for this request

```text
docs/TOURNAMENT_FLYER_TEMPLATE_SELECTION_DIRECTIONS.md
server/index.js
server/lib/rbac.js
src/components/TournamentTemplateFields.tsx
src/index.css
src/lib/tournament-templates.ts
src/pages/HostPortal.tsx
src/pages/OrganizerTournaments.tsx
src/pages/TournamentPortal.tsx
test/app.test.js
```

## Validation performed

- Complete application test suite: 217 passed, 0 failed.
- Dependency security tests: 8 passed, 0 failed.
- `node --check` passed for the modified server and test JavaScript files.
- Project TypeScript diagnostics were compared with the pre-change cumulative baseline. The diagnostic set is identical; no new TypeScript errors were introduced. Existing baseline errors remain in `App.tsx`, location typing, and the missing `roundInsights.js` declaration.
- `npm audit --audit-level=high --omit=dev` was attempted. The configured package registry returned HTTP 404 for the npm audit endpoint, so a live registry audit could not complete. No dependency was added or changed by this implementation.
- A Vite production build was attempted using the uploaded Windows `node_modules`. It cannot run in this Linux workspace because the Linux Rollup optional package `@rollup/rollup-linux-x64-gnu` is absent. A clean `npm install` on the deployment platform installs the correct native dependency and invokes the existing postinstall build.

## Deployment

Extract the changed-files ZIP into the GolfHomiez application root while preserving paths, then run:

```bash
npm install
```

Restart the application with the existing deployment process after the postinstall migration/build process succeeds.
