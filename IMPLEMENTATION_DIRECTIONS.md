# Golf Homiez phone, SMS, reset-flow, and logging update

## Changed application paths

Backend:
- `server/lib/admin-portal.js` — host account request notifications now go to `golfhomiez@outlook.com`.
- `server/sms.js` — SMS delivery now uses the existing application SMTP mailer through an SMTP-to-SMS gateway address, with SMTP-log entries and correlation IDs.
- `server/auth.js` — golf-user password reset supports `email` or `sms` delivery.
- `server/lib/host-auth.js` — host password reset supports `email` or `sms` delivery.
- `server/lib/organizer-auth.js` — organizer password reset token schema/helpers were added and support `email` or `sms` delivery.
- `server/index.js` — golfer profile phone validation/storage, profile-update SMS notification, host/organizer reset APIs, and correlated API logging were wired.
- `server/migrations/index.js` — migration `20260514_038` is registered with idempotent checks.

Frontend:
- `src/pages/Profile.tsx` — golfer profile now requires and validates a phone number after first sign-in.
- `src/lib/profile.ts` — profile payload/types now include phone data.
- `src/lib/phone-validation.ts` — added required-phone validation while preserving optional phone validation used by host/organizer profiles.
- `src/pages/ForgotPassword.tsx` and `src/lib/auth-api.ts` — golf-user reset flow now offers email or SMS.
- `src/pages/HostForgotPassword.tsx` and `src/lib/host-auth.ts` — host reset flow now offers email or SMS.
- `src/pages/OrganizerForgotPassword.tsx`, `src/pages/OrganizerResetPassword.tsx`, `src/pages/OrganizerLogin.tsx`, `src/lib/organizer-auth.ts`, and `src/App.tsx` — organizer reset pages/routes/API client were added.

Configuration and tests:
- `.env.example`, `.env.docker.example`, `.env.mysql.example` — added `SMS_EMAIL_DOMAIN=` for SMTP-to-SMS gateway configuration.
- `test/app.test.js` — added regression coverage for host notification address, golfer phone validation/storage, SMTP SMS notifications, and email/SMS reset flow wiring.

## Database migration

New migration file:
- `migration_scripts/20260514_038_app_user_phone_sms_reset_support.sql`

Schema changes:
- Adds `app_users.phone VARCHAR(64) NULL`.
- Adds `app_users.phone_updated_at DATETIME NULL`.
- Adds `organizer_password_reset_tokens` for organizer password reset links.

## Deployment / local implementation steps

1. Apply the changed files over the existing application paths.
2. Set SMTP configuration as before (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, etc.).
3. Set `SMS_EMAIL_DOMAIN` to the SMTP-to-SMS gateway domain used by your SMS provider or carrier integration. If unset, SMS messages are logged to `logging/smtp.log` as a development fallback and are not externally delivered.
4. Run `npm install` in each environment. The existing `postinstall` script runs `npm run db:migrate && npm run build`, so migration `20260514_038` will apply automatically during install.
5. For production deployments that do not run `npm install` on the target server, run `npm run db:migrate` before starting the new application version.
6. Start the application with the existing environment-based `PORT` value. No port values were hardcoded.

## Logging

The existing correlation-id logging now covers the added flows:
- Access lifecycle: `logging/access.log`
- API transactions and reset/profile events: `logging/api.log`
- Front-end reset/profile events: `logging/frontend.log`
- SMTP and SMTP-backed SMS delivery: `logging/smtp.log`
- Errors and warnings: `logging/error.log`

Search the same `correlationId` across those files to follow a complete transaction lifecycle.

## Verification run

- `npm test` passed: 96 tests passing.
- `npm run build` could not complete in this extracted sandbox because the provided `node_modules` tree was missing Rollup optional dependency `@rollup/rollup-linux-x64-gnu`. Re-running `npm install` in the target environment should restore that optional dependency before build.
