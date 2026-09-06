# User Images Implementation - 2026-09-06

## Scope

This change adds persistent compressed image uploads for logged golf rounds, challenge rounds, and tournaments.

- Logged rounds: maximum 3 pictures.
- Challenge rounds: maximum 3 pictures; only the golfer who created the challenge may upload or delete pictures.
- Tournaments: maximum 8 pictures.
- Tournament pictures are viewable from a dedicated tournament pictures page when the tournament has images.
- The hole-by-hole score view exposes a Pictures action and displays the completed-hole score relative to par as `+N`, `-N`, or `Par` instead of the previous Course Par tile.
- Images are stored under the application `userimages` directory (or `USER_IMAGES_DIR` when configured), with database metadata stored in `user_images`.

## Persistence

The default storage directory is:

`<application-root>/userimages`

The directory is created automatically by the server at runtime. The entire `userimages/` directory is ignored by Git so neither uploaded images nor placeholder contents are committed.

For Docker deployments, `docker-compose.yml` mounts the host `./userimages` directory into `/app/userimages` and sets `USER_IMAGES_DIR=/app/userimages`. This keeps uploaded pictures across application/container restarts as long as the application directory/volume is retained.

For non-Docker production deployments, keep `userimages` on persistent disk and optionally set:

`USER_IMAGES_DIR=/absolute/persistent/path/userimages`

The application process must have read/write permission to the directory.

## Image compression and validation

The browser compresses selected images before upload to reduce storage usage. The server independently validates that uploaded data is JPEG, PNG, or WebP and verifies the file signature instead of trusting only the MIME declaration. The server rejects stored payloads larger than the configured implementation limit.

No new npm dependency was introduced for image processing; browser canvas APIs are used for client-side compression.

## Database migration

New migration:

`migration_scripts/20260906_086_user_images.sql`

Migration registration:

`server/migrations/index.js`

The migration creates the `user_images` table and indexes for entity lookup, uploader lookup, and correlation-id diagnostics.

The existing install flow remains:

`npm install` -> `postinstall` -> `npm run db:migrate` -> `npm run build`

Therefore the migration is included automatically when deploying through the normal npm install process.

## Logging and correlation IDs

Image list, upload, delete, and image-serving transactions use the application's existing request correlation ID. API-side image activity is written through the existing API/error logging pipeline, and client-side picture actions use the existing frontend logging mechanism. Image URLs propagate the request correlation ID using `cid` so related access/API/frontend/error events can be searched as one transaction lifecycle.

Existing separate access, API, frontend, and error log handling is retained; this change does not replace the application's logging infrastructure.

## Deployment paths

Copy the changed files from the ZIP to these paths relative to the application root:

- `.env.example`
- `.env.docker.example`
- `.gitignore`
- `docker-compose.yml`
- `package.json`
- `migration_scripts/20260906_086_user_images.sql`
- `server/index.js`
- `server/lib/user-images.js`
- `server/migrations/index.js`
- `src/App.tsx`
- `src/components/HoleByHoleScorecard.tsx`
- `src/components/PictureLibraryModal.tsx`
- `src/components/RoundDetailModal.tsx`
- `src/components/TournamentManagementLineItem.tsx`
- `src/components/TournamentPicturesField.tsx`
- `src/index.css`
- `src/lib/accounts.ts`
- `src/lib/hole-scorecard.ts`
- `src/lib/user-images.ts`
- `src/pages/Challenges.tsx`
- `src/pages/HostPortal.tsx`
- `src/pages/MyTournaments.tsx`
- `src/pages/SoloLogger.tsx`
- `src/pages/TournamentPictures.tsx`
- `src/pages/TournamentPortal.tsx`
- `src/types.ts`
- `test/app.test.js`
- `test/user-images.test.js`
- `docs/20260906-user-images-implementation.md`

## Verification performed

`node --test test/user-images.test.js`

Result after the follow-up implementation: 5 passed, 0 failed.

`npm test`

Result after the follow-up implementation: 390 tests total, 383 passed, 7 failed.

The untouched uploaded baseline was also run and produced the same 7 existing failures: 385 tests total, 378 passed, 7 failed. The seven existing failures are therefore not newly introduced by this image implementation.

Existing failing test names:

1. retired homepage demo seed code and npm command are removed
2. host portal lets hosts modify every golf-course tournament and exposes published or completed tournament URLs
3. tournament portal uses per-user registration and host-organizer portals keep team roster status
4. tournament portal includes a close button back to my tournaments
5. tournament capacity defaults, migration, API stats, and correlated logging are wired
6. published GolfHomiez tournaments are synchronized into Find Tournaments with correlated logging
7. homepage demo statistics assets and seeded records are retired through migration

JavaScript syntax checks for `server/index.js` and `server/lib/user-images.js` completed successfully.

The production Vite build could not be completed in this Linux execution environment because the uploaded `node_modules` tree is missing Rollup's Linux optional native package (`@rollup/rollup-linux-x64-gnu`). Running a clean `npm install` in the target environment should restore platform-specific optional dependencies before the normal build.

`npm audit --audit-level=high` could not reach `registry.npmjs.org` from this execution environment (`EAI_AGAIN`). No new runtime or development dependency was added by this implementation, so the change itself does not introduce a new dependency vulnerability. Run `npm audit --audit-level=high` after `npm install` in an environment with npm registry access and resolve any reported high-severity findings before production deployment.
