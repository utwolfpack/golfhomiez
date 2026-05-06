# Auth TTL and logging implementation directions

## Changed application paths

- `server/auth.js` — Better Auth user sessions use a 24-hour TTL and refresh on authenticated activity.
- `server/lib/admin-portal.js` — admin session cookies now use a 24-hour TTL.
- `server/lib/host-auth.js` — host sessions now use a 24-hour TTL, refresh `host_sessions.expires_at` on activity, and reset the cookie Max-Age on authenticated requests.
- `server/index.js` — access/API logging includes correlation IDs, admin and host session checks refresh TTL on activity, and `PORT` is read from the environment.
- `src/lib/frontend-logger.ts`, `src/lib/api.ts`, `src/lib/auth-api.ts`, `src/lib/request.ts`, `src/lib/session-expiration.ts` — front-end request/error logging binds to the same correlation ID and redirects expired sessions to the correct login page on 401.
- `src/context/AuthContext.tsx` and `src/context/HostAuthContext.tsx` — authenticated front-end activity triggers a throttled session refresh to keep the sliding TTL alive.
- `migration_scripts/20260501_023_auth_ttl_and_logging_support.sql` — production migration for session-expiration indexes and stale host/organizer session cleanup.

## How authentication TTL is tracked

- Admin accounts: `golf_admin_session` is an HttpOnly signed cookie. The token contains an `exp` timestamp. On every successful admin session or protected admin request, the server issues a replacement cookie with a fresh expiration 24 hours from that request.
- User and organizer role accounts: Better Auth manages the session record/cookie. `expiresIn` is 24 hours and `updateAge` is `0`, so authenticated session checks refresh the expiration window on activity.
- Host accounts: `host_sessions.expires_at` stores the server-side session expiration. `getHostAccountBySession` only accepts non-expired rows and refreshes `expires_at` to 24 hours from the current request. The server also sends a refreshed `golfhomiez_host_session` cookie.
- Expired sessions return 401/null session responses. The front end logs `session_ttl_exhausted_redirect` and navigates users to `/login`, hosts to `/host/login`, and admins to `/golfadmin`.

## Production migration steps

1. Back up the production database.
2. Deploy the code changes.
3. Run this migration against the production database:

```bash
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < migration_scripts/20260501_023_auth_ttl_and_logging_support.sql
```

4. Confirm `PORT`, `CLIENT_ORIGIN`, and `BETTER_AUTH_URL` are set in production `.env`.
5. Restart the application.
6. Verify logs in `logging/access.log`, `logging/api.log`, `logging/error.log`, and `logging/frontend.log` by searching for the same `correlationId`.
