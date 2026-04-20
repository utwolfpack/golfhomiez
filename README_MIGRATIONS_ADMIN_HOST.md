# RBAC and Admin Portal migrations

`npm run build` already runs `npm run db:migrate`, so these schema changes are applied once per database environment through the migration runner.

## New migration

- `migration_scripts/20260420_014_rbac_admin_portal_reconcile.sql`

## What it covers

- RBAC base tables
  - `role_definitions`
  - `user_role_assignments`
  - `host_role_accounts`
  - `organizer_role_accounts`
  - `tournaments`
- Admin portal compatibility fields
  - `host_accounts.account_name`
  - `host_account_invites.account_name`
- Existing admin and host auth tables continue to be reconciled by `server/migrations/index.js` for mixed local, stage, and production schemas.

## How to run

Normal deploy:

```bash
npm ci
npm run build
npm start
```

Manual schema-only run:

```bash
npm run db:migrate
```

## Run once per environment

Migrations are tracked in `app_schema_migrations`. Each environment applies each migration once for its own database.

## Production notes

The dynamic migration logic in `server/migrations/index.js` checks `information_schema` and only adds missing tables, columns, and indexes. This makes the migration safe for databases that already have part of the admin or host schema in place.
