# Admin + RBAC migration patch

This patch adds a production-safe reconciliation migration for admin portal, RBAC, and host portal support tables.

## Included files

- `migration_scripts/20260420_015_admin_rbac_portal_compat.sql`
- `server/migrations/index.js`
- `server/run-migrations.js`
- `package.json`

## What it fixes

- `admin_users.password_salt` missing in production
- other missing admin/host compatibility columns and indexes
- missing RBAC support tables
- migration runner failing when `dotenv` is not installed but environment variables already exist

## Run manually

```bash
npm run db:migrate
```

## Build + migrate

```bash
npm run build
```

## Re-run this migration if needed

```sql
DELETE FROM app_schema_migrations WHERE version = '20260420_015';
```
