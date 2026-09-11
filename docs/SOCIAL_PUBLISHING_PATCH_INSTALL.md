# Social publishing patch installation

This patch replaces the in-app OAuth and MySQL credential store with server-only `.env` configuration. It retains per-platform publication history and retries.

## Install the patch

1. Back up the application and database.
2. Extract the patch ZIP over the GolfHomiez project root, preserving the paths in the archive.
3. Update the production server `.env` using the social-publishing section from `.env.example`.
4. Run `npm install`. The existing `postinstall` workflow runs `npm run db:migrate` before the production build.
5. Restart the application using its existing process manager.
6. Open Golf Admin, select Scheduled Jobs, and verify that all enabled providers report Configured.

No source files need to be deleted manually. `server/lib/social-oauth.js` is intentionally retained as a compatibility tombstone. Migration `20260909_088_remove_social_platform_connections.sql` removes the obsolete database table.

## Confirmed account identifiers

```env
FACEBOOK_PAGE_ID=61593610114459
FACEBOOK_PAGE_NAME=Golf Homiez
INSTAGRAM_USERNAME=golfhomiez
LINKEDIN_ORGANIZATION_ID=143741977
LINKEDIN_ORGANIZATION_NAME=Golf Homiez
YOUTUBE_CHANNEL_NAME=Golf Homiez
```

`INSTAGRAM_ACCOUNT_ID`, access tokens, refresh tokens, client ids, and client secrets must be obtained from the respective provider developer consoles. Do not commit them, add them to this patch archive, or expose them to the frontend.

## Files in the patch

- `.env.example`
- `migration_scripts/20260909_088_remove_social_platform_connections.sql`
- `server/index.js`
- `server/lib/logger.js`
- `server/lib/scheduled-jobs.js`
- `server/lib/social-oauth.js`
- `server/lib/social-publisher.js`
- `server/lib/social-publishing-crypto.js`
- `server/lib/social-publishing-store.js`
- `server/migrations/index.js`
- `src/lib/admin.ts`
- `src/pages/AdminScheduledJobs.tsx`
- `test/social-publishing.test.js`
- `docs/CURRENT_EVENTS_COMMERCIAL_JOB.md`
- `docs/FUNNY_SHOTS_COMMERCIAL_JOB.md`
- `docs/GREAT_SHOTS_COMMERCIAL_JOB.md`
- `docs/SOCIAL_COMMERCIAL_PUBLISHING.md`
- `docs/SOCIAL_PUBLISHING_PATCH_INSTALL.md`

## Verification

- Run `npm test`.
- Run `npm run build`.
- Run `npm audit --audit-level=high`.
- Search a scheduled-job correlation id in `logging/access.log`, `logging/api.log`, `logging/error.log`, `logging/frontend.log`, and `logging/scheduled-jobs.log`.
