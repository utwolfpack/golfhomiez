# Golf Homiez Better Auth Build

This build removes the last legacy auth calls from the frontend. Login and registration now call Better Auth endpoints directly:
- POST /api/auth/sign-in/email
- POST /api/auth/sign-up/email
- GET /api/auth/get-session
- POST /api/auth/sign-out
- POST /api/auth/request-password-reset
- POST /api/auth/reset-password

Local start:
```bash
npm install
npm run dev
```

Local password reset:
- Go to /
- Submit your email
- The server sends the reset email through Brevo SMTP and also stores the latest reset link for local debugging

Production / CloudPanel:
- Set BETTER_AUTH_URL to your public backend origin
- Set CLIENT_ORIGIN to your frontend origin
- Set the Brevo SMTP variables in .env or docker-compose.yml to deliver reset emails

---

# Golf Homiez

This build uses Better Auth for email/password sign-up, sign-in, and cookie-based sessions.

## Local development

Prerequisites:
- Node 18+
- Docker Desktop running

Run:

```bash
npm install
npm run dev
```

`npm run dev` will:
- create a local `.env` if one does not exist
- start the local MySQL container with Docker Compose
- wait for MySQL to be ready
- start the Express API and Vite client

Local URLs:
- client: `http://localhost:5174`
- api: `http://localhost:5001`

## Production / CloudPanel

1. Create a MySQL or MariaDB database in CloudPanel.
2. Copy `.env.mysql.example` to `.env` and fill in the real values.
3. Set `BETTER_AUTH_SECRET` to a long random value.
4. Run:

```bash
npm install
npm run build
npm start
```

## Notes

- Legacy auth routes and legacy auth tables are removed.
- Legacy user-data migration has been removed on purpose.
- Password reset emails are wired through the built-in SMTP mailer. Update the SMTP variables if you change providers.
