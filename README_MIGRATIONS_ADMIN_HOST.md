# Admin and Host auth migrations

This patch adds two production-safe app migrations:

- `20260416_012_admin_portal_direct_auth.sql`
- `20260417_013_host_auth_portal.sql`

## What they create

### 20260416_012

- `admin_users`
- `admin_password_reset_tokens`
- `host_account_invites`

### 20260417_013

- `host_accounts`
- `host_sessions`
- `host_password_reset_tokens`

## How they run

Migrations are tracked in `app_schema_migrations`, so each migration runs once per database environment.

The build now includes:

```bash
npm run build
```

That does:

```bash
npm run build:app
npm run db:migrate
```

The migration runner is also available directly:

```bash
npm run db:migrate
```

## Production deployment

Recommended order:

```bash
npm ci
npm run build
npm start
```

If the build environment does not have database access, the migration runner safely skips execution unless:

```bash
REQUIRE_DB_MIGRATIONS=true
```

is set.

## Notes

- The migration runner is idempotent.
- New tables are created when missing.
- Existing partial tables are reconciled by adding only missing columns and indexes.
- This makes the migrations safe for local, stage, and production environments that may not be perfectly aligned.
