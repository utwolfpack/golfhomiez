# Reset SMS Delivery Fix

## Issue found from the uploaded logs

The browser requested SMS delivery for the golf-user password reset flow, but the server sent the reset link by email instead.

Evidence from the logs:

- `frontend.log` shows `auth_request_password_reset_sms` and `deliveryMethod: sms` for `/request-password-reset`.
- `access.log` shows the server accepted `POST /api/auth/request-password-reset` with HTTP 200.
- `api.log` shows `auth_password_reset_email_sent` instead of `auth_password_reset_sms_sent`.
- `smtp.log` shows Brevo email delivery to the user's email address and no `sms_send_started` entry for the reset request.

Root cause: the Better Auth reset-password callback was not reliably receiving the custom `deliveryMethod` value from the JSON request body, so the callback defaulted to email.

## Changed files and application paths

Copy these files into the same paths in the application root:

- `src/lib/auth-api.ts`
  - Adds `X-Password-Reset-Delivery` to the golf-user password reset request.
- `server/auth.js`
  - Reads reset delivery preference from the request header first, then falls back to JSON body parsing when possible.
  - Adds `auth_password_reset_requested` logging so the selected delivery path is visible in `api.log`.
- `server/index.js`
  - Allows `X-Password-Reset-Delivery` through CORS.
- `test/app.test.js`
  - Adds regression checks for the reset SMS delivery header and server-side handling.

## Deployment directions

1. Extract the zip into the application root.
2. Ensure your SMS settings are configured in `.env`.
   - For the existing SMTP-to-SMS gateway implementation, set `SMS_EMAIL_DOMAIN` to the carrier gateway domain and set `SMS_DEV_FALLBACK=false` in production.
   - Do not set `SMS_EMAIL_DOMAIN` to a URL, app domain, or mailbox address.
3. Run `npm install` if dependencies are not current.
4. Run `npm test`.
5. Restart the application.

## Migration directions

No database migration is required for this fix. The existing phone fields and reset token tables are reused.

## Expected verification after deployment

When choosing **Send reset SMS** for a golf-user account with a saved phone number, the logs should show the same correlation ID across the request lifecycle:

- `frontend.log`: `auth_request_password_reset_sms`
- `api.log`: `auth_password_reset_requested` with `deliveryMethod: sms`
- `smtp.log`: `sms_send_started` and `sms_send_succeeded`, or `sms_configuration_error` if SMS provider settings are not configured correctly
- `api.log`: `auth_password_reset_sms_sent`

If `api.log` shows `auth_password_reset_sms_skipped_missing_phone`, the user account does not have a usable phone number saved in `app_users.phone`.
