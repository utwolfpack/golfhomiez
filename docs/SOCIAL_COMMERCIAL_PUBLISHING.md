# Automated social publishing for commercial scheduled jobs

GolfHomiez can publish successful MP4s from the Current Events, Great Shots, and Funny Shots scheduled jobs to Facebook, Instagram, LinkedIn, and YouTube. Social failures never change a successfully generated commercial run to failed.

## Server environment configuration

Publishing credentials are read directly from the server `.env` file. They are never returned by the configuration API or rendered in the Scheduled Jobs page. Do not put provider passwords in `.env`.

```env
SOCIAL_AUTO_PUBLISH=true
SOCIAL_PUBLIC_BASE_URL=https://golfhomiez.com
SOCIAL_MEDIA_SIGNING_SECRET=

SOCIAL_PUBLISH_FACEBOOK=true
SOCIAL_PUBLISH_INSTAGRAM=true
SOCIAL_PUBLISH_LINKEDIN=true
SOCIAL_PUBLISH_YOUTUBE=true

META_GRAPH_API_VERSION=v24.0
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_NAME=Golf Homiez
FACEBOOK_PAGE_ACCESS_TOKEN=

INSTAGRAM_ACCOUNT_ID=
INSTAGRAM_USERNAME=golfhomiez
INSTAGRAM_ACCESS_TOKEN=

LINKEDIN_ORGANIZATION_ID=
LINKEDIN_ORGANIZATION_NAME=GolfHomiez
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_ACCESS_TOKEN_EXPIRES_AT=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REFRESH_TOKEN=
LINKEDIN_API_VERSION=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_CHANNEL_ID=
YOUTUBE_CHANNEL_NAME=Golf Homiez
YOUTUBE_PRIVACY_STATUS=public
YOUTUBE_CATEGORY_ID=17
```

`SOCIAL_PUBLIC_BASE_URL` must be the public HTTPS origin that reaches this Node server. Instagram retrieves the MP4 through a short-lived signed URL. Set `SOCIAL_MEDIA_SIGNING_SECRET`, or leave it blank to use the existing `BETTER_AUTH_SECRET`.

## Provider setup

### Facebook and Instagram

Use a Facebook Page access token with `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. The Instagram account must be a Business or Creator account linked to the Facebook Page.

Set `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, and `INSTAGRAM_ACCOUNT_ID`. When `INSTAGRAM_ACCESS_TOKEN` is blank, GolfHomiez reuses `FACEBOOK_PAGE_ACCESS_TOKEN`.

### LinkedIn

Set the numeric organization id and an access token authorized for organization posting, including `w_organization_social`. A static `LINKEDIN_ACCESS_TOKEN` is supported directly. If LinkedIn has approved the application for programmatic refresh tokens, configure the refresh token and client credentials instead.

### YouTube

Enable YouTube Data API v3 and create OAuth web-application credentials. Generate an offline refresh token for `https://www.googleapis.com/auth/youtube.upload`, then configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `YOUTUBE_REFRESH_TOKEN`. GolfHomiez exchanges the refresh token for a short-lived access token before uploads.

## Publication and retry behavior

The `social_publications` table stores one row per scheduled-job run and platform. Its unique key prevents duplicate posts. Successful platforms are not posted again when another platform fails. Transient network, rate-limit, and server errors use exponential backoff; administrators can also select **Retry failed social posts** after correcting `.env`.

The Scheduled Jobs API and page report only whether each platform is enabled and configured, which variables are missing, the non-secret account id/name, and the credential source variable name.

## Logging

Publication, retry, signed-media, configuration-load, and frontend actions use the existing request correlation id. Search the same id in:

- `logging/access.log`
- `logging/api.log`
- `logging/error.log`
- `logging/frontend.log`
- `logging/scheduled-jobs.log`

The logger redacts provider access tokens, refresh tokens, client secrets, signed-media secrets, OAuth codes, and authorization headers.

## Schema deployment

Migration `20260909_087_social_publishing.sql` creates publication history and the former connection table. Migration `20260909_088_remove_social_platform_connections.sql` removes the obsolete connection table while retaining `social_publications`.

The existing `postinstall` script runs `npm run db:migrate`, so `npm install` applies both migrations in local, stage, and production environments.
