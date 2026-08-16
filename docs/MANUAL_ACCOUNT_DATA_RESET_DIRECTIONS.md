# Manual Account Data Reset Scripts

These scripts create a clean data environment by deleting **all accounts for one selected account type** and the records directly owned by that account type.

The supported manual reset types are:

- `user`
- `host`
- `organizer`

Admin account reset scripts are intentionally excluded. There is no `data:reset:admin` NPM wrapper and no admin SQL reset script.

These scripts are manual-only. They are not registered in `server/migrations/index.js`, are not included in the normal app migration runner, and are not executed by `npm install` or `postinstall`.

## Files added

| Account type | Manual SQL script | NPM wrapper |
| --- | --- | --- |
| User | `migration_scripts/manual_account_resets/reset_user_accounts.sql` | `npm run data:reset:user` |
| Host | `migration_scripts/manual_account_resets/reset_host_accounts.sql` | `npm run data:reset:host` |
| Organizer | `migration_scripts/manual_account_resets/reset_organizer_accounts.sql` | `npm run data:reset:organizer` |

The NPM wrappers execute `server/scripts/reset-account-data.js` with the selected account type and account-type-wide scope.

## What each reset does

### User

Deletes all golfer user data from supported Better Auth and GolfHomiez tables where they exist:

- Better Auth `session`, `account`, `verification`, and `user` rows in the selected user scope
- `email_verification_tokens`
- `app_users`
- `user_role_assignments`
- `scores`
- `scorecard_hole_drafts`
- `team_members`
- teams that become empty after the user memberships are removed
- `inbox_messages`
- `inbox_challenge_user_state`
- `tournament_registrations`

### Host

Deletes all host account data and host-managed tournament/profile records where the tables exist:

- `host_sessions`
- `host_password_reset_tokens`
- `host_account_requests`
- `host_account_invites`
- `golf_course_public_pages`
- `organizer_tournament_invites`
- host-managed `tournaments`
- tournament child records in `tournament_registrations`, `tournament_team_scores`, `tournament_team_start_assignments`, and `golf_course_tournaments`
- `host_accounts`
- `host_role_accounts`
- host `user_role_assignments`

### Organizer

Deletes all organizer account data and organizer-owned tournament records where the tables exist:

- `organizer_sessions`
- `organizer_password_reset_tokens`
- `organizer_tournament_invites`
- organizer-owned `tournaments`
- tournament child records in `tournament_registrations`, `tournament_team_scores`, `tournament_team_start_assignments`, and `golf_course_tournaments`
- `organizer_role_accounts`
- organizer `user_role_assignments`

## Recommended execution process

Run a dry run first from the project root:

```bash
npm run data:reset:user -- --dry-run
npm run data:reset:host -- --dry-run
npm run data:reset:organizer -- --dry-run
```

Review the matched account counts and row counts printed by the command. The script rolls back the transaction during a dry run.

After the dry run looks correct, execute the reset manually with both confirmation flags:

```bash
npm run data:reset:user -- --confirm --confirm-delete-all
npm run data:reset:host -- --confirm --confirm-delete-all
npm run data:reset:organizer -- --confirm --confirm-delete-all
```

The second `--confirm-delete-all` flag is required because each command deletes every account in the selected account type scope.

Targeted flags are intentionally unsupported. Do not use `--email`, `--identifier`, `--file`, `RESET_ACCOUNT_IDENTIFIERS`, or account-specific `RESET_*_IDENTIFIERS` values with these scripts.

## Manual SQL execution

The SQL files are also full account-type reset scripts. To execute one manually in DBeaver or another SQL client, edit both confirmation variables at the top of the chosen file:

```sql
SET @confirm_manual_account_reset := 'YES';
SET @confirm_reset_all_accounts := 'YES';
```

Then execute the entire SQL file against the intended database only.


## MySQL work-table behavior

The Node.js reset runner creates short-lived `manual_reset_*` MEMORY work tables and drops them at the start and end of each run. These are intentionally regular work tables instead of MySQL temporary tables because MySQL can throw `ER_CANT_REOPEN_TABLE` when the same temporary table is referenced more than once in a reset statement. If a previous run is interrupted, the next run drops and recreates the work tables before building a new reset scope.

The runner also normalizes string comparisons with `CONVERT(... USING utf8mb4) COLLATE utf8mb4_general_ci`. This avoids `ER_CANT_AGGREGATE_2COLLATIONS` failures when existing application tables use a mix of collations such as `utf8mb4_general_ci` and `utf8mb4_0900_ai_ci`.

## Logging and correlation ids

Every NPM wrapper run writes a correlation id to the console and logs the lifecycle through the existing logging system. Search the same correlation id across:

```text
logging/access.log
logging/api.log
logging/error.log
```

The log entries include the selected account type, whether the run was a dry run, matched scope counts, row counts, and commit/failure status.

## Deployment notes

- These files are not automatic migrations.
- Do not add them to `server/migrations/index.js`.
- Do not add them to `postinstall`.
- Run them only after confirming the target environment and taking a database backup.
- Prefer running the dry-run command against the exact database first, then run the confirmed command only after reviewing the printed counts.
