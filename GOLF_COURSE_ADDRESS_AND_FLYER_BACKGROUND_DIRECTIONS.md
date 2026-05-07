# Tournament portal refinement directions

## Changed application paths

- `src/components/ImageUploadField.tsx` — reusable image upload UI component.
- `src/lib/image-upload.ts` — reusable browser-side image compression/data URL utility with front-end logging.
- `src/components/TournamentTemplateFields.tsx` — organizer/host tournament modification form now supports compressed flyer background uploads, uses reusable image upload, and removes the duplicate Event date field.
- `src/pages/TournamentPortal.tsx` — tournament flyer renders the uploaded background image translucently behind flyer content and uses the tournament date plus golf-course address for Location.
- `src/lib/tournament-templates.ts` — removed duplicate `eventDate` template metadata.
- `src/lib/accounts.ts` — adds `hostGolfCourseAddress` to tournament data.
- `server/index.js` — enriches tournament portal responses with golf-course address and keeps uploaded background image persistence in the existing tournament template background field.
- `server/lib/golf-course-service.js` — imports, stores, and returns golf-course address/postal code data.
- `server/migrations/index.js` — adds migration `20260507_027_golf_course_address_fields`.
- `test/app.test.js` — verifies the reusable image upload/compression, translucent flyer background, removed Event date field, location address behavior, logging/correlation support, and migration coverage.

## Migration implementation

The migration is registered in `server/migrations/index.js` as `20260507_027_golf_course_address_fields` and adds nullable `address` and `postal_code` columns to `golf_courses` when that table exists.

Run locally or in production:

```bash
npm install
```

`npm install` already runs `npm run db:migrate` through the existing `postinstall` script. To run migrations directly:

```bash
npm run db:migrate
npm run golf-courses:import
```

Run `npm run golf-courses:import` after the migration so existing golf-course catalog rows are repopulated with address and postal code values from `opengolfapi-us.courses.042026.csv`.

## Logging

The existing separate log files remain in use:

- Access logs: `logs/access.log`
- API/error logs: `logs/api.log` and `logs/error.log`
- Front-end logs: `logs/frontend.log`

Image upload/compression and tournament portal transactions emit front-end events with the same `X-Correlation-Id` flow already used by `src/lib/request.ts`, `/api/client-logs`, and the server access/API/error loggers.
