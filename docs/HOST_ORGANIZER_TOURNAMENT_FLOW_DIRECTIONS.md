# Host and Organizer Tournament Flow

## Scope

This change simplifies host tournament creation while preserving the organizer's invited-tournament management role.

### Host creation flow

- The create panel starts collapsed.
- Opening the create panel hides all existing tournament records so the host can focus on the new tournament.
- **Tournament name** is required. **Organizer email (optional)** remains visible in the initial view.
- All other tournament fields are optional and are available through **Show optional tournament fields**.
- One submit action creates the tournament. An organizer invitation is sent only when an organizer email is supplied.
- The tournament location defaults from the `golf_courses` record linked to the approved host account. A host-entered location continues to take precedence.
- After creation, the form resets, the create panel closes, and the tournament list is reloaded. A host can invite an organizer later from the tournament record. If email delivery fails, the created tournament remains available, preventing an accidental duplicate tournament.

### Host and organizer modification flow

- Selecting a tournament hides all other tournament records until the selected tournament is saved or cancelled.
- Host and organizer modification forms continue to expose the same tournament content fields.
- Organizers remain limited to tournaments to which a host has invited them; this change does not add unrestricted organizer tournament creation.

## Golf-course location resolution

The server resolves the default location in this order:

1. The exact `golf_courses` record associated with the host account, using `golf_course_id` when available.
2. The approved host's GolfHomiez public golf-course page address.
3. A golf-course catalog name lookup when needed.
4. The related golf-course name as a safe fallback.

The server applies the default again during tournament creation so the behavior does not depend only on browser state.

## Validation

Host-created tournaments require a non-empty tournament name. Organizer email is optional, but it must be syntactically valid when provided.

Tournament date, description, registration deadline, team limit, flyer content, contact details, images, and other template content remain optional while the tournament is a draft. The existing publish validation still requires a tournament date before publishing.

## Logging and correlation

The existing persisted `X-Correlation-Id` is used by frontend requests and server middleware, allowing related records to be searched across:

- `logging/access.log`
- `logging/api.log`
- `logging/frontend.log`
- `logging/error.log`

New or expanded events include:

- `host_tournament_create_panel_opened` (retained for compatibility)
- `host_tournament_create_panel_minimized` (retained for compatibility)
- `host_tournament_create_flow_started`
- `host_tournament_create_flow_minimized`
- `host_tournament_optional_fields_toggled`
- `host_tournament_create_validation_failed`
- `host_tournament_create_started`
- `host_tournament_created`
- `host_tournament_create_failed`
- `host_tournament_invite_after_create_failed`
- `host_tournament_default_location_resolved`
- `host_tournament_public_page_location_lookup_failed`
- `host_tournament_course_location_lookup_failed`
- `host_tournament_edit_started`
- `host_tournament_edit_cancelled`
- `tournament_edit_started`
- `tournament_edit_cancelled`

## Changed application paths

```text
server/index.js
server/lib/rbac.js
src/components/TournamentTemplateFields.tsx
src/lib/tournament-templates.ts
src/pages/HostPortal.tsx
src/pages/OrganizerTournaments.tsx
src/pages/TournamentPortal.tsx
test/app.test.js
docs/HOST_ORGANIZER_TOURNAMENT_FLOW_DIRECTIONS.md
docs/HOST_TOURNAMENT_DEFAULTS_OPTIONAL_ORGANIZER_DIRECTIONS.md
```

## Database and migrations

No schema change is required for this feature, so no new migration script was added. The existing installation workflow continues to run every registered migration before building:

```bash
npm install
```

The project's `postinstall` command runs cleanup, `db:migrate`, and the production build. In stage and production environments, retain:

```env
REQUIRE_DB_MIGRATIONS=true
```

## Deployment

1. Extract the changed-files ZIP into the GolfHomiez application root while preserving paths.
2. Run `npm install` using the Node.js version declared in `package.json`.
3. Restart the stage or production application through the environment's existing PM2 or process-manager workflow.
4. Sign in as an approved host and verify the course location appears after expanding the optional fields.
5. Create a host-managed draft using only the tournament name, then add and invite an organizer later.
6. Create another draft with an organizer email and verify that the organizer receives the invitation and can modify the invited tournament.
7. Search the four application log files by the request correlation ID if a transaction needs diagnosis.

No ports were added or hardcoded, and no dependencies were introduced by this change.

## Verification commands

```bash
npm test
npm run test:security
npm run security:audit
```

The registry-backed audit requires access to the configured npm registry and its audit endpoint.

## Validation results in the supplied workspace

- `npm test`: 199 passed, 0 failed.
- `npm run test:security`: 8 passed, 0 failed.
- JavaScript syntax checks: passed.
- Modified TypeScript/TSX transpilation checks: passed.
- No dependencies were added or changed.
- `npm audit --audit-level=high` was attempted, but the configured package registry returned HTTP 404 for the npm audit endpoint. Run the audit again in the deployment environment where the registry audit endpoint is available.
- The Vite build could not run against the uploaded Windows `node_modules` in this Linux workspace because the Linux Rollup optional binary was absent. A clean `npm install` on the target platform installs the correct native package before the postinstall build.

## Latest defaults update

See `docs/HOST_TOURNAMENT_DEFAULTS_OPTIONAL_ORGANIZER_DIRECTIONS.md` for the linked golf-course address lookup, hidden host-organization default, 08:00 check-in time, 08:30 tee time, and standard tournament-format suggestions.
