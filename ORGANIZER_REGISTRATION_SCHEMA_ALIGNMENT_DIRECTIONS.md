# Organizer Registration Schema Alignment Fix

## Root cause

The organizer invite email was sent successfully, but registration failed on `POST /api/organizer/register` because the stage database `organizer_role_accounts` table did not include the columns now used by organizer registration.

Observed error:

```text
Unknown column 'contact_name' in 'field list'
```

## Changed files

```text
server/lib/organizer-auth.js
server/lib/rbac.js
server/migrations/index.js
migration_scripts/20260508_028_host_tournament_creation_schema_alignment.sql
migration_scripts/20260508_029_organizer_invite_schema_alignment.sql
migration_scripts/20260508_030_organizer_registration_schema_alignment.sql
test/app.test.js
ORGANIZER_REGISTRATION_SCHEMA_ALIGNMENT_DIRECTIONS.md
```

## Deployment steps

1. Copy the files from this zip into the application root, preserving paths.
2. Run:

```bash
npm install
```

The existing `postinstall` flow runs `npm run db:migrate && npm run build`, so migration `20260508_030` will be applied during install.

If installing dependencies is not needed, run:

```bash
npm run db:migrate && npm run build
```

3. Restart the Node process for the stage app.
4. Re-test organizer registration from the invite link.

## Migration details

`20260508_030_organizer_registration_schema_alignment` adds these missing organizer account columns when absent:

```text
contact_name
phone
website_url
notes
password_hash
reset_email
```

The migration is idempotent through `server/migrations/index.js` checks.
