# Tournament Team Start Scheduling and Default Golf Banner

## Summary

This change replaces the host profile fallback banner with `public/DefaultGolfBanner.jpg` and adds editable team start scheduling for host- and organizer-managed tournaments.

Tournament format suggestions are now team-oriented. After teams register, a host or invited organizer can auto-create either a shotgun schedule or sequential tee times, adjust the generated assignments, and save the final schedule. Public tournament pages display the assignments directly below the team-slot summary.

## User flow

1. Create a tournament and choose a team tournament format.
2. Select **Shotgun Start** or **Tee times** in the tournament fields.
3. For tee times, set the interval in minutes. The supported range is 5–60 minutes and the default is 10.
4. After at least one team registers, open the tournament for editing in either the host or organizer portal.
5. Select **Auto-create team schedule**.
6. Review and edit each team's start time, starting hole/tee, and optional notes.
7. Select **Save team schedule**. Use **Clear schedule** to remove all assignments when needed.
8. Open the public tournament page to view the assignments below the available team-slot count.

For shotgun starts, teams are assigned across holes 1–18. Additional teams use lettered follow-up assignments such as `1B`, `2B`, and so forth. For tee-time starts, each team receives a sequential start time based on the configured interval.

## Database migration

The migration is:

```text
migration_scripts/20260806_069_tournament_team_start_assignments.sql
```

It creates `tournament_team_start_assignments` with:

- A persistent assignment per tournament/team.
- The registration and GolfHomiez team identifiers when available.
- Start method, time, starting hole/tee, display order, and notes.
- The updating user and request correlation ID.
- Cascading cleanup when a tournament is deleted.
- Unique and lookup indexes for tournament schedule operations.

The migration is registered in `server/migrations/index.js` and is idempotent for new and partially migrated environments.

## API routes

Host routes:

```text
POST /api/host/tournaments/:id/start-schedule/auto
PUT  /api/host/tournaments/:id/start-schedule
```

Organizer routes:

```text
POST /api/organizer/tournaments/:id/start-schedule/auto
PUT  /api/organizer/tournaments/:id/start-schedule
```

Auto-create request example:

```json
{
  "startType": "tee-times",
  "firstStartTime": "08:30",
  "intervalMinutes": 10
}
```

Manual-save request example:

```json
{
  "assignments": [
    {
      "teamKey": "team:TEAM_ID",
      "teamName": "Fairway Finders",
      "startType": "shotgun",
      "startTime": "08:30",
      "startingHole": "1",
      "sortOrder": 0,
      "notes": "Check in by 8:00 AM"
    }
  ]
}
```

Only teams currently registered for the tournament can be saved. Duplicate or stale team assignments return a friendly validation message.

## Logging

The existing request correlation ID is retained through access, API, error, and frontend logs. Relevant events include:

```text
tournament_start_schedule_auto_created
tournament_start_schedule_saved
tournament_start_schedule_cleared
host_tournament_start_schedule_validation_failed
organizer_tournament_start_schedule_validation_failed
tournament_start_assignments_load_failed
tournament_start_schedule_auto_create_failed
tournament_start_schedule_save_failed
```

Search the same correlation ID in:

```text
logging/access.log
logging/api.log
logging/error.log
logging/frontend.log
```

## Changed application paths

```text
docs/TOURNAMENT_TEAM_START_SCHEDULE_DIRECTIONS.md
migration_scripts/20260806_069_tournament_team_start_assignments.sql
package.json
public/DefaultGolfBanner.jpg
server/index.js
server/lib/rbac.js
server/lib/tournament-start-schedule.js
server/migrations/index.js
src/components/TournamentStartScheduleManager.tsx
src/components/TournamentTemplateFields.tsx
src/index.css
src/lib/accounts.ts
src/lib/tournament-templates.ts
src/pages/GolfCoursePage.tsx
src/pages/HostPortal.tsx
src/pages/HostProfile.tsx
src/pages/OrganizerTournaments.tsx
src/pages/TournamentPortal.tsx
test/app.test.js
test/tournament-start-schedule.test.js
```

## Deployment

Extract the changed-files package into the application root while preserving paths, then run:

```bash
npm install
```

The existing `postinstall` command runs cleanup, all database migrations, and the production build. For stage and production, set:

```env
REQUIRE_DB_MIGRATIONS=true
```

Then restart the application using the existing PM2 or production process-manager configuration.

No ports are added or hardcoded by this change. No dependencies are added.

## Verification

Run:

```bash
npm test
npm run test:security
npm audit --audit-level=high --omit=dev
npm run build
```

Functional checks:

1. Confirm `/host/portal/profile` uses `DefaultGolfBanner.jpg` when no host-uploaded banner exists.
2. Confirm team tournament format suggestions appear in host and organizer forms.
3. Register multiple teams for a tournament.
4. Auto-create a shotgun schedule and verify each team receives a time and starting hole.
5. Change the start method to tee times, set an interval, and auto-create again.
6. Edit an assignment and save it as both a host and organizer.
7. Confirm stale or duplicate teams are rejected with a friendly message.
8. Confirm the public tournament page lists saved assignments below the team-slot summary.
9. Confirm access, API, error, and frontend records share the same correlation ID for schedule operations.
