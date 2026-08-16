# Manual User Delete Script

This manual script deletes one target user and related GolfHomiez records by email address.

It is manual-only. It is not part of `npm install`, `postinstall`, or the automatic `db:migrate` migration runner.

## What it deletes

The Node runner builds a scoped deletion plan for the target email and related account ids. It can delete records from the following areas when they are associated with the target email:

- Better Auth user/session/account/verification records.
- GolfHomiez app profile rows.
- User role assignments.
- Scores and scorecard drafts.
- Inbox messages and challenge visibility state.
- Tournament registrations and tournament child records.
- Host accounts, host role accounts, host sessions, host reset tokens, host requests/invites, and golf course public pages.
- Organizer accounts, organizer sessions, organizer reset tokens, and organizer tournament invites.
- Tournaments owned by the target host/organizer/user account.
- Team memberships and scoped teams.

## How to run

Always run a dry run first:

```bash
npm run data:delete-user -- --email target@example.com --dry-run
```

After reviewing the matched scope and table counts, execute the delete:

```bash
npm run data:delete-user -- --email target@example.com --confirm
```

The same email can also be passed through an environment variable:

```bash
DELETE_USER_EMAIL=target@example.com npm run data:delete-user -- --dry-run
```

## Manual SQL script

A SQL reference script is stored at:

```text
migration_scripts/manual_user_delete/delete_user_by_email.sql
```

Use the Node runner for normal operations because it adapts to missing optional tables/columns and prints row counts. Use the SQL file only when direct MySQL execution is required.

## Logging

Every run prints and logs a correlation id. Search the correlation id in:

```text
logging/access.log
logging/api.log
logging/error.log
```

## Safety notes

- Verify `.env` database settings before running the command.
- Use `--dry-run` first in every environment.
- The delete does not run unless `--confirm` is supplied.
- Do not add this script to automatic startup, install, or deployment hooks.
