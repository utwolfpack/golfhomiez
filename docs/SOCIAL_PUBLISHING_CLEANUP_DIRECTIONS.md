# Social publishing cleanup directions

## Scope

The failed automatic social-media publishing implementation has been removed from the Scheduled Jobs admin flow. The Current Events, Great Shots, and Funny Shots scheduled jobs continue to generate MP4 files, retain Pexels quota/metadata display, and retain the authenticated **Download latest MP4** action.

The MP4 download now carries the browser correlation ID on the download request. That same value is written by the existing request middleware and download route to access/API/error diagnostics and by the frontend logger to `frontend.log`, which makes a download transaction searchable across the logging lifecycle.

## Database cleanup

Migration `migration_scripts/20260916_089_remove_social_publishing_implementation.sql` is registered in `server/migrations/index.js`. It:

- drops the obsolete `social_platform_connections` table if it still exists;
- drops the obsolete `social_publications` table;
- removes the obsolete `socialPublishing` property from historical scheduled-job output JSON.

Historical migrations `20260909_087` and `20260909_088` remain in the repository because migration history is append-only for already-deployed environments. The new cleanup migration removes their runtime schema artifacts safely.

The existing `npm install` flow remains:

`postinstall -> cleanup:project-files -> db:migrate -> build`

## Files that must be deleted from an existing checkout

Remove these files when applying the patch to an existing project tree:

- `server/lib/social-oauth.js`
- `server/lib/social-publisher.js`
- `server/lib/social-publishing-crypto.js`
- `server/lib/social-publishing-store.js`
- `docs/SOCIAL_COMMERCIAL_PUBLISHING.md`
- `docs/SOCIAL_PUBLISHING_PATCH_INSTALL.md`
- `test/social-publishing.test.js`

## Environment cleanup

The application no longer reads the social auto-publishing variables that were previously documented. They were removed from `.env.example`. Existing deployed `.env` files may also remove the obsolete `SOCIAL_*`, Facebook/Instagram publishing, LinkedIn publishing, and YouTube refresh-token values after confirming they are not used by another service.

Keep `PEXELS_API_KEY`, FFmpeg settings, and commercial-generation settings because they are still used to create downloadable MP4 files.

## Verification

Run:

```text
npm test
npm run build
npm run test:security
npm audit --audit-level=high
```

The dependency set is unchanged by this cleanup. The lockfile already pins `brace-expansion` 5.0.9 and `nanoid` 3.3.18, the patched versions covered by the existing dependency-security test.
