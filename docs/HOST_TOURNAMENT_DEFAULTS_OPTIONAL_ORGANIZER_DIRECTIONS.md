# Host Tournament Defaults and Optional Organizer

## Scope

This update keeps tournament creation lightweight for golf-course hosts while applying consistent golf-course defaults across host, organizer, and public tournament views.

## Implemented behavior

### Golf-course address and organization defaults

- The server resolves the tournament location from the `golf_courses` record associated with the authenticated host account, using `host_accounts.golf_course_id` when available.
- If the linked catalog record cannot provide an address, the existing public golf-course page address is used, followed by the golf-course name as a safe fallback.
- The tournament template's hidden `hostOrganization` value defaults to the host account's golf-course name.
- Host and organizer edit forms apply the same location, host-organization, check-in, and tee-time defaults to older tournament records when those values are missing.
- Public tournament pages use the tournament's golf-course name when a stored host-organization value is unavailable.

### Optional organizer

- Only the tournament name is required to create a host-managed draft.
- **Organizer email (optional)** remains visible in the default create-tournament view.
- When an organizer email is supplied, tournament creation is followed by the existing organizer invitation flow.
- When the field is blank, the tournament is created and remains fully host-managed.
- A host can add and invite an organizer later from the tournament record.
- A supplied organizer email is still validated on both the frontend and backend.

### Tournament defaults

New tournament forms default to:

```text
Check-in time: 08:00
Tee time:      08:30
Host organization: authenticated host golf-course name (hidden field)
Location: linked golf_courses address
```

The tournament-format field remains free text and now provides standard suggestions through a browser datalist:

```text
Scramble
Best Ball
Stroke Play
Match Play
Shamble
Stableford
Alternate Shot
Four-Ball
Chapman / Pinehurst
```

Hosts and organizers can enter a custom format instead of selecting a suggested value.

## Logging and correlation

The existing `X-Correlation-Id` lifecycle remains in place across:

```text
logging/access.log
logging/api.log
logging/frontend.log
logging/error.log
```

New or expanded diagnostic data covers:

- Exact host-account golf-course catalog location resolution.
- Location, host-organization, check-in-time, and tee-time default application.
- Whether an organizer invitation was requested during creation.
- Optional organizer validation failures.
- Later organizer invitation success and failure.
- Host and organizer edit flows applying missing tournament defaults.

Relevant events include:

```text
host_tournament_default_location_resolved
host_tournament_account_course_location_lookup_failed
host_tournament_create_started
host_tournament_created
host_tournament_create_validation_failed
host_tournament_organizer_invited
host_tournament_organizer_invite_failed
host_tournament_invite_validation_failed
tournament_edit_started
```

## Changed application paths

```text
docs/HOST_TOURNAMENT_DEFAULTS_OPTIONAL_ORGANIZER_DIRECTIONS.md
server/index.js
server/lib/rbac.js
src/components/TournamentTemplateFields.tsx
src/lib/tournament-templates.ts
src/pages/HostPortal.tsx
src/pages/OrganizerTournaments.tsx
src/pages/TournamentPortal.tsx
test/app.test.js
```

## Database and migrations

No database schema change is required. The existing `tournaments.organizer_email` column already permits `NULL`, and tournament template defaults are stored in the existing `template_data` JSON field.

No new migration script was added. The existing installation process continues to run all registered migrations:

```bash
npm install
```

For stage and production deployments, retain:

```env
REQUIRE_DB_MIGRATIONS=true
```

## Deployment

1. Extract the changed-files ZIP into the GolfHomiez application root while preserving paths.
2. Run `npm install` with the Node.js version declared in `package.json`.
3. Restart the application with the environment's existing PM2 or process-manager configuration.
4. Sign in as an approved host and open **Create tournament**.
5. Verify the organizer email is optional and remains visible without expanding optional fields.
6. Expand optional fields and verify the linked golf-course address, 08:00 check-in, and 08:30 tee time.
7. Verify **Host organization** is not displayed and the public tournament page uses the golf-course name.
8. Create one tournament without an organizer and invite an organizer later from the tournament record.
9. Create another tournament with an organizer email and verify the invitation is sent immediately.

No ports were added or hardcoded, and no dependencies were added or changed.

## Verification

```bash
npm test
npm run test:security
npm audit --audit-level=high
```

Workspace validation results:

- `npm test`: 199 passed, 0 failed.
- `npm run test:security`: 8 passed, 0 failed.
- JavaScript syntax checks: passed.
- Modified TypeScript/TSX transpilation checks: passed.
- No dependencies were added or changed.
- `npm audit --audit-level=high` reached the configured registry, but that registry returned HTTP 404 for the audit endpoint. Run the audit again in the deployment environment with a working npm audit endpoint.
- The Vite build could not run against the uploaded Windows `node_modules` from this Linux workspace because the Linux Rollup optional binary was unavailable. A clean `npm install` on the deployment platform installs the correct native package and runs the existing postinstall build.
