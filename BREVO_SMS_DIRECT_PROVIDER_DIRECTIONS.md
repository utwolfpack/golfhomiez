# Brevo SMS Direct Provider Fix

## Root cause

The reset password SMS request was reaching the backend and was being treated as SMS, but `server/sms.js` was still using the old SMTP-to-SMS gateway provider. The logs showed `sms_dev_fallback` with `provider: "smtp-sms"` and `configuredGateway: false`, so no call was made to Brevo Transactional SMS and no activity appeared in Brevo SMS logs.

## Changed files

Copy these files into the same paths in the application root:

- `server/sms.js`
- `server/auth.js`
- `server/lib/host-auth.js`
- `server/lib/organizer-auth.js`
- `server/index.js`
- `.env.example`
- `.env.docker.example`
- `.env.mysql.example`
- `test/app.test.js`

## Environment configuration

Set these in the application `.env` file:

```env
SMS_PROVIDER=brevo
SMS_DEFAULT_COUNTRY_CODE=1
SMS_DEV_FALLBACK=false
BREVO_SMS_SENDER=GolfHomiez
BREVO_SMS_TYPE=transactional
BREVO_SMS_API_KEY=
BREVO_API_KEY=your-brevo-api-key
```

Notes:

- `SMS_PROVIDER=brevo` is required to use Brevo Transactional SMS directly.
- `BREVO_SMS_API_KEY` is optional. If it is blank, the app uses `BREVO_API_KEY`.
- `BREVO_SMS_SENDER` must be 1-11 alphanumeric characters or 1-15 numeric characters. `GolfHomiez` is valid. `Golf Homiez` is not valid for SMS because it contains a space.
- `SMS_DEFAULT_COUNTRY_CODE=1` converts a stored 10-digit U.S. phone number such as `8019109951` to `18019109951` before sending to Brevo.
- Leave `SMS_EMAIL_DOMAIN` blank when using `SMS_PROVIDER=brevo`; it is only for the old SMTP-to-SMS gateway provider.
- `SMS_DEV_FALLBACK=false` prevents the app from reporting a successful SMS when no real SMS provider is configured.

## What changed

- Added a direct Brevo Transactional SMS provider using `POST https://api.brevo.com/v3/transactionalSMS/send`.
- Preserved the old SMTP-to-SMS gateway path for compatibility when `SMS_PROVIDER=smtp-sms`.
- Added provider-specific logging in `logging/smtp.log`:
  - `sms_send_started`
  - `sms_send_succeeded`
  - `sms_send_failed`
  - `sms_configuration_error`
- Added support for password-reset SMS tags:
  - `golfhomiez-password-reset`
  - `golfhomiez-host-password-reset`
  - `golfhomiez-organizer-password-reset`
- Changed reset/profile logging so dev fallback is logged as fallback instead of normal sent delivery.
- Added test coverage that verifies a 10-digit reset phone number is sent to the Brevo Transactional SMS endpoint as `18019109951`.

## Migration scripts

No database schema changes were made for this fix, so no new migration script is required.

The existing install process already runs database migrations through:

```bash
npm install
```

The existing `postinstall` script runs:

```bash
npm run db:migrate && npm run build
```

If production does not run `npm install`, run this before restarting the application:

```bash
npm run db:migrate
```

## Deploy steps

1. Extract the changed files into the application root.
2. Update `.env` with the Brevo SMS settings above.
3. Confirm Brevo SMS is enabled on the Brevo account and the account has any required SMS credits/compliance setup.
4. Run:

```bash
npm install
npm test
npm run build
```

5. Restart the application.
6. Send a reset SMS and search the logs by correlation ID.

Expected `logging/smtp.log` entries after a real Brevo SMS attempt:

```json
{"message":"sms_send_started","provider":"brevo-sms"}
{"message":"sms_send_succeeded","provider":"brevo-sms"}
```

If configuration is missing, expect:

```json
{"message":"sms_configuration_error","provider":"brevo-sms"}
```

## Verification performed

- `npm test` passed: 98/98 tests.
- `node --check` passed for the modified server files.
- `npm run build` could not complete in the sandbox because the provided `node_modules` is missing Rollup's optional native package `@rollup/rollup-linux-x64-gnu`. Run `npm install` in the target environment to restore optional dependencies, then run `npm run build`.
