# Better Auth on CloudPanel

## 1. Create the database

In CloudPanel, create a MySQL or MariaDB database and a database user.

## 2. Configure environment variables

Use values like these in your CloudPanel Node.js site:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=your_cloudpanel_database
DB_USER=your_cloudpanel_database_user
DB_PASSWORD=your_cloudpanel_database_password
PORT=5001
BETTER_AUTH_SECRET=replace-with-a-long-random-secret-at-least-32-characters
BETTER_AUTH_URL=https://your-domain.example
```

## 3. Install and start

```bash
npm install
npm run build
npm start
```

## 4. Reverse proxy

Point the CloudPanel site to the Node app port you chose, usually `5001`.

## 5. HTTPS

Enable SSL in CloudPanel before testing login so Better Auth cookies behave correctly in production.

## 6. Optional password reset email

To enable reset emails, implement `sendResetPassword` in `server/auth.js` using SMTP, Mailgun, Postmark, Resend, SendGrid, or another provider.
