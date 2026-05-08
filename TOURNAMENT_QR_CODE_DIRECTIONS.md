# Tournament QR Code Update Directions

## Changed application paths

- `src/pages/TournamentPortal.tsx`
  - Replaces the placeholder text in the flyer QR CODE section with an `<img>` that loads a QR code for the current tournament page.
  - Logs front-end QR load and QR load failure events with the same correlation id used by the QR image request.

- `src/lib/tournament-qr.ts`
  - Builds the public QR-code image URL for a tournament id or public tournament identifier.
  - Appends the front-end correlation id as `cid` so access, API, and front-end logs can be searched together.

- `server/index.js`
  - Adds `GET /api/tournament-portals/:id/qr-code.svg`.
  - Resolves the tournament by id or public tournament identifier, enforces published-only visibility, generates the QR SVG on the backend, and writes API log events.

- `server/lib/qr-code.js`
  - Provides local QR SVG generation without adding a third-party package or relying on an external QR-code service.

- `server/lib/logger.js`
  - Allows image/pixel requests to bind to an existing transaction by accepting a safe `cid` or `correlationId` query parameter when request headers are not available.

- `test/app.test.js`
  - Adds coverage for QR SVG generation, route wiring, front-end QR rendering, and shared correlation id support.

## Migration directions

No database schema changes were required for this QR-code feature. The QR code is generated from the existing tournament portal route and public tournament identifier data.

Because no schema changed, no new SQL migration file is needed. Existing environments should still run the normal install/deploy flow so all already-pending migrations are applied:

```bash
npm install
```

The current `package.json` already runs the migration process during install through:

```json
"postinstall": "npm run db:migrate && npm run build"
```

For production deployment, ensure the production `.env` contains the normal database settings and `PORT`. The application continues to read runtime port configuration from the `.env` `PORT` variable; no port was hardcoded for this change.

## Verification

Run:

```bash
npm test
npm run build
```

Manual verification:

1. Open a published tournament page at `/tournaments/<tournament-id-or-public-identifier>`.
2. Confirm the flyer QR CODE section displays a QR image.
3. Scan the QR code and confirm it opens the same tournament page.
4. Search the same correlation id across:
   - `logging/access.log`
   - `logging/api.log`
   - `logging/frontend.log`
   - `logging/error.log` if a QR-code error occurs
