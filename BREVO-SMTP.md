# Brevo SMTP relay setup

Golf Homiez now supports Brevo SMTP relay using either the existing `SMTP_*` variables or Brevo-specific aliases.

## Supported environment variables

Preferred Brevo names:
- `BREVO_SMTP_LOGIN`
- `BREVO_SMTP_KEY`
- `BREVO_SENDER_EMAIL`
- `BREVO_SENDER_NAME`

Backward-compatible SMTP names:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

## Recommended Brevo settings

- Host: `smtp-relay.brevo.com`
- Port: `465`
- Secure: `true`
- Username/Login: your Brevo SMTP login
- Password: your Brevo SMTP key
- From: a verified Brevo sender email

## Files to edit for credentials

Local development:
- `.env`

Template/example files:
- `.env.example`
- `.env.docker.example`
- `.env.mysql.example`

Production hosting:
- your hosting provider's environment variable settings panel

## Notes

- Use your **Brevo SMTP key**, not your Brevo API key.
- Use a sender email/domain that is verified in Brevo.
- The mailer falls back to console logging when credentials are missing.
