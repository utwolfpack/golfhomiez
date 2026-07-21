# Auth TTL and logging deployment directions

The auth session TTL and correlated logging support are deployed through the existing migration runner. The `postinstall` script already runs `npm run db:migrate && npm run build`, so installing dependencies in another environment applies supported schema changes before the application starts.

## Migration script

Run or deploy this migration through the app migration runner:

- `migration_scripts/20260501_023_auth_ttl_and_logging_support.sql`

## Production implementation

1. Set the production `.env` values for `PORT`, database credentials, `BETTER_AUTH_URL`, and the public client origin values required by the deployment.
2. Run `npm install`. The `postinstall` lifecycle runs `npm run db:migrate`, which executes the migration runner and records applied schema versions in `app_schema_migrations`.
3. Start the application with `npm start` after migration completion.
4. Confirm correlated entries are being written under `logging/access.log`, `logging/api.log`, `logging/error.log`, `logging/frontend.log`, and `logging/smtp.log`.

Do not hardcode server ports in the application. The server reads `process.env.PORT`.
