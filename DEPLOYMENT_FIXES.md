# Production deployment fixes for golfhomiez.com

## What was likely breaking on production

The frontend auth client could be compiled with a localhost auth base URL from `.env`:

- `VITE_AUTH_BASE_URL=http://127.0.0.1:5001/api/auth`
- `CLIENT_ORIGIN=http://127.0.0.1:5174`
- `BETTER_AUTH_URL=http://127.0.0.1:5001`

When that happens, a production browser can load the HTML shell, but auth/session requests point at localhost instead of the live domain. That makes login, session bootstrap, protected pages, and any auth-dependent rendering fail.

## Code changes included

1. `src/lib/auth-api.ts`
   - falls back to same-origin `/api/auth`
   - automatically ignores a localhost build-time auth URL when the site is running on a public domain

2. `server/index.js`
   - allows both `golfhomiez.com` and `www.golfhomiez.com` origins
   - keeps local development origins intact

3. `src/components/NavBar.tsx` and `src/index.css`
   - improved mobile layout so navigation and dashboard grids stack correctly on smaller screens

4. `server/scripts/seed-gold-records.js`
   - seeds 50 demo users/teams
   - seeds 50 solo rounds and 50 team rounds

## Production environment values to use

Set these in the production server environment before building:

```env
NODE_ENV=production
CLIENT_ORIGIN=https://golfhomiez.com
BETTER_AUTH_URL=https://golfhomiez.com
# optional — safest to omit so the frontend uses same-origin /api/auth
# VITE_AUTH_BASE_URL=/api/auth
```

If you serve the site on `www.golfhomiez.com`, set both the reverse proxy and `CLIENT_ORIGIN`/`BETTER_AUTH_URL` to the exact public URL you want users to use.

## Deploy steps

```bash
rm -rf node_modules dist
npm install
npm run build
npm start
```

## Seed demo records

After the database is ready:

```bash
node server/scripts/seed-gold-records.js
```

## Important note about demo logins

The seed script creates demo user/account rows, but the password hash placeholder must be replaced with a real bcrypt hash before using those accounts for login demonstrations.
