# Tournament Template Polish and Registration Deadline Validation

## Summary

This update removes the saved-draft flyer preview feature, prevents a tournament registration deadline from being later than the tournament date, and polishes all six tournament flyer templates so missing images, sponsor placeholders, icon blocks, and low-contrast text do not leave unfinished-looking areas.

No database schema changes are required.

## Draft flyer preview removal

The host and organizer tournament-management pages no longer show either of these draft-only actions:

- `Preview saved draft flyer`
- `Open preview`

The draft-preview query-string flow has also been removed from the frontend API client, QR-code client, tournament page, and backend. Tournament portal and QR-code routes now remain public only for `published` and `completed` tournaments. Draft tournaments continue to return not-found behavior from the public tournament routes.

## Registration deadline validation

The Registration deadline date input now uses the tournament date as its maximum selectable date when a tournament date is available.

Frontend and backend validation both reject a registration deadline later than the tournament date with this user-facing message:

```text
Registration Deadline cannot be after the Tournament Start Date. Select a deadline on or before the tournament date and try again.
```

An invalid registration deadline date is also rejected with a specific friendly message. Host and organizer update routes classify these errors as validation errors and return HTTP 400 rather than a generic server failure. Existing correlation-ID logging records the validation failure in the normal frontend/API transaction lifecycle.

## Flyer image and icon improvements

### Default charity image

The default charity image is now:

```text
public/tournament-templates/DefaultCharityGrass.svg
```

It uses a light green grassy/fairway background with golf imagery so the beneficiary area remains visually complete when no charity image is uploaded.

### Tournament detail icons

The public flyer no longer renders the existing JPEG/PNG tournament attribute images inside filtered `<img>` elements. Those image backgrounds were producing the blank white square areas shown in the supplied screenshots.

Date, check-in time, tee time, course, location, tournament format, and registration fee now use inline SVG icons. The same icon system is used by:

- Classic Golf Homiez
- Fairway Poster
- Modern Golf Open
- Charity & Memorial
- Sunset Drive
- Green Invitation
- Printable flyer detail rows
- Prize/award and contest/extras headings

Because the icons use `currentColor`, each template automatically receives the correct light or dark icon contrast for its background.

### Template text contrast

Flyer highlight panels now explicitly use dark text on their light panel backgrounds. This resolves the missing/washed-out list text shown on the Charity & Memorial template while preserving the template-specific heading accent color.

### Sponsor areas

When no sponsor logo images exist, the flyer no longer renders empty sponsor slots or placeholder copy such as `Your logo here`, `Sponsor opportunities available`, or `Ask about sponsor opportunities`.

Sponsor sections are rendered only when at least one sponsor logo exists. If an uploaded sponsor image fails to load, the failed logo is hidden so it does not leave a broken-image or blank placeholder area. Sponsor image load failures are written to frontend logging with the existing correlation ID.

## Logging

This change uses the existing shared correlation-ID infrastructure across:

```text
logging/access.log
logging/api.log
logging/frontend.log
logging/error.log
```

Relevant events include the existing host/organizer validation failure events and the new/expanded frontend event:

```text
tournament_sponsor_logo_load_failed
```

Draft-preview-specific logging was removed along with the draft-preview feature.

## Files changed

```text
docs/TOURNAMENT_DRAFT_PREVIEW_GREEN_INVITE_DIRECTIONS.md
docs/TOURNAMENT_TEMPLATE_POLISH_AND_REGISTRATION_DEADLINE_DIRECTIONS.md
public/tournament-templates/DefaultCharityGrass.svg
server/index.js
server/lib/rbac.js
src/components/TournamentTemplateFields.tsx
src/index.css
src/lib/accounts.ts
src/lib/tournament-errors.ts
src/lib/tournament-qr.ts
src/lib/tournament-templates.ts
src/pages/HostPortal.tsx
src/pages/OrganizerTournaments.tsx
src/pages/TournamentPortal.tsx
test/app.test.js
```

## Database migrations

No migration is required. The update uses the existing tournament `start_date` and `template_data.registrationDeadline` values and removes application behavior rather than adding schema.

The existing install process remains unchanged and continues to apply all registered migrations:

```text
npm run cleanup:project-files && npm run db:migrate && npm run build
```

For stage and production environments continue to use:

```env
REQUIRE_DB_MIGRATIONS=true
```

## Deployment

Extract the change package into the GolfHomiez application root and preserve the paths, then run:

```bash
npm install
```

Restart the existing PM2/production process after installation completes.

No port values or dependencies were added or changed.

## Validation performed

```text
npm test: 219 passed, 0 failed
npm run test:security: 8 passed, 0 failed
server JavaScript syntax checks: passed
changed TypeScript/TSX transpilation checks: passed
full TypeScript diagnostics: only previously existing errors in unchanged files
```

The full TypeScript check still reports the project's existing JSX namespace, location-model typing, and `roundInsights.js` declaration errors. None of the files changed by this request appear in the TypeScript error output.

`npm audit --audit-level=high --omit=dev` was attempted. The npm registry could not be resolved from this execution environment (`EAI_AGAIN registry.npmjs.org`), so a live audit result could not be retrieved. No dependency or package-version changes were made, and the project's dependency-security tests pass.
