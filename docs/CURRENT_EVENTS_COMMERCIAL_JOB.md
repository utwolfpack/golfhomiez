# Create Short-form Current Events - Small

## Purpose

`Create Short-form Current Events - Small` is registered in the existing GolfHomiez Admin **Scheduled jobs** page. It defaults to **Manual**, can be changed to Daily, Weekly, or Monthly with the existing scheduler controls, and runs as a cancellable background job when started manually.

Each run:

1. Makes bounded requests to the configured sources: Golf Digest, GOLF.com, Golf Channel, Golfweek, PGA TOUR News, LPGA News, Golf Monthly, MyGolfSpy, Skratch Golf, and No Laying Up.
2. Extracts headline-like text and looks for a golf topic present on at least two successful sources.
3. Uses the server-side `PEXELS_API_KEY` to search Pexels Photos and Pexels Videos for portrait-oriented golf imagery related to the selected topic. A short Pexels video is preferred for one scene when available, followed by Pexels photos.
4. Extracts page-preview and article-card image candidates from the same news-source HTML as a secondary visual pool. Relative image URLs are resolved against the publisher page, and obvious logos/icons/tracking images are rejected.
5. Downloads up to three usable Pexels/news visuals with bounded time and size limits. Pexels videos are MP4-only and 2-30 seconds; the renderer uses up to two seconds of the selected stock clip for its current-events scene. Image/video download failures are warning-level and never prevent the commercial from being produced.
6. Generates lightweight GolfHomiez golf-scene artwork locally for any missing visual slots. This fallback uses no npm image-generation dependency and keeps the commercial visually complete when external visuals are blocked or irrelevant.
7. Renders a fast three-beat vertical story: **Trending Now**, **Make It Yours**, and **Tee It Up**. Each scene gets subtle motion, high-contrast copy, source attribution, GolfHomiez branding, and the final `golfhomiez.com` call to action.
8. Produces an approximately six-second, 720x1280 H.264 MP4 using the existing `src/assets/GolfHomiezEmblem.png` asset.
9. Writes the output to `jobs/commercials` without overwriting any existing MP4.


## Pexels media, quota metadata, and Admin downloads

The Great Shots, Funny Shots, and Current Events commercial jobs share the same server-side `PEXELS_API_KEY`. Current Events uses Pexels as its **primary visual source** and searches both:

- `GET https://api.pexels.com/v1/search` for portrait golf photos; and
- `GET https://api.pexels.com/v1/videos/search` for portrait golf videos.

The selected news topic is included in the Pexels search query when possible; if the topic-specific query produces no usable media, the job falls back to a general professional-golf query. Pexels media is clearly attributed in the rendered source label and its creator/source-page metadata is persisted in `scheduled_job_runs.output_json`.

Every successful Pexels API response is inspected for `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, and `X-Ratelimit-Reset`. GolfHomiez stores the latest observed values in the commercial run output and exposes them on **Admin -> Scheduled jobs** for Current Events, Great Shots, and Funny Shots. The UI shows remaining/total requests, used requests, reset time, and the last time the quota was observed without making an extra Pexels request just to refresh the page.

The same Scheduled jobs row exposes the **latest successful MP4**, including file name, duration, resolution, size, completion time, and a `Download latest MP4` link. The download route is Admin-authenticated and resolves only `.mp4` files under `jobs/commercials`, preventing arbitrary path downloads. A later failed run does not hide the most recent successful commercial.

If `PEXELS_API_KEY` is not configured or Pexels is unavailable, Current Events continues with publisher images and generated GolfHomiez artwork.

## Output naming and overwrite protection

The first run for a date uses:

`jobs/commercials/Create Short-form Current Events - Small - YYYY-MM-DD.mp4`

If that file already exists, subsequent runs increment the filename:

- `Create Short-form Current Events - Small - YYYY-MM-DD - 2.mp4`
- `Create Short-form Current Events - Small - YYYY-MM-DD - 3.mp4`
- and so on.

The job uses a short-lived `.lock` reservation file to keep concurrent runs from selecting the same name. ffmpeg renders to a temporary MP4 and the completed file is copied into the reserved destination with exclusive-create semantics, so an existing commercial is never replaced.

Generated MP4s, temporary rendering files, and lock files are runtime artifacts and are intentionally ignored by Git. `jobs/.gitkeep` and `jobs/commercials/.gitkeep` preserve the directory structure in source control.

## Visual sourcing and fallback behavior

Publisher visuals are treated as optional enhancements rather than a hard dependency. The job:

- reads `og:image`, `twitter:image`, and useful page `<img>` candidates;
- resolves relative publisher image paths to absolute URLs;
- considers nearby article-card text when deciding whether an image is related to the selected topic;
- prefers images from publishers that contributed to the common topic;
- rejects obvious logos, icons, avatars, tracking pixels, and unrelated images;
- caps each downloaded image at 8 MB;
- requests JPEG/PNG/WebP/GIF rather than AVIF and byte-sniffs downloaded images before naming them;
- rejects AVIF/HEIF responses (including AVIF bytes returned from a `.webp`/`.jpg` URL) and continues to the next image so ffmpeg is never handed a mislabeled adaptive image; and
- attributes publisher-sourced visuals in the commercial using the publisher name.

If fewer than three relevant website images are available, the remaining scenes use generated GolfHomiez golf artwork. This keeps the ad visually engaging instead of falling back to a text-only screen.

## News-source failure handling

News sites can reject automated requests even when their pages are public. A source-level HTTP failure is recoverable and does **not** fail the scheduled job.

Golf Channel currently requires extra handling because `/news` can return HTTP 403 to server-side requests. The job:

- sends normal browser-compatible request headers;
- retries same-publisher Golf Channel pages when `/news` is blocked;
- records every attempted URL/status in `api.log` and `scheduled-jobs.log`;
- treats expected 4xx source blocking as a warning rather than a fatal application error; and
- continues with the other sources and the normal GolfHomiez fallback if necessary.

The job still fails only when a fatal step such as MP4 rendering cannot be recovered.

## ffmpeg runtime handling

The application does not require a developer to manually install ffmpeg before the job can run.

Resolution order is:

1. Use the executable specified by `FFMPEG_PATH` when it resolves successfully.
2. Reuse the GolfHomiez-managed ffmpeg runtime under `.runtime/ffmpeg/6.1.1/<platform>-<arch>/` when it already exists.
3. Try the host `ffmpeg` command.
4. If the command is missing and `FFMPEG_AUTO_DOWNLOAD` is enabled, download the platform-specific ffmpeg 6.1.1 binary from the `eugeneware/ffmpeg-static` GitHub release, validate both the compressed archive and extracted executable with pinned SHA-256 checksums, store it under `.runtime/ffmpeg`, and retry the render in the same job run.

The scheduled job performs this setup automatically on demand. Operators can also run `npm run setup:ffmpeg` explicitly after deployment to pre-warm the managed runtime. That setup command is deliberately best-effort so an offline or restricted environment does not make application installation fail.

Docker deployments continue to install ffmpeg through `Dockerfile`, so production containers normally never need the managed download.

Configuration:

- `FFMPEG_PATH=ffmpeg` uses PATH first while still allowing the managed fallback.
- `FFMPEG_AUTO_DOWNLOAD=true` enables the verified managed download. Set to `false` only when host-level ffmpeg management is required.
- `FFMPEG_DOWNLOAD_TIMEOUT_MS=120000` controls the binary-download timeout and accepts 10,000 through 600,000 milliseconds.
- `CURRENT_EVENTS_FETCH_TIMEOUT_MS=10000` controls each news-source attempt and accepts 1,000 through 60,000 milliseconds.
- `CURRENT_EVENTS_FONT_FILE=` optionally points to a readable `.ttf`, `.otf`, or `.ttc` font. Leave blank for automatic Windows/Linux/macOS system-font discovery. The renderer always supplies an explicit font file to ffmpeg so Windows managed builds do not depend on Fontconfig defaults.

The `.runtime/` directory is ignored by Git because the downloaded executable is operating-system/architecture specific.

## Logging and correlation

Manual Admin runs keep the request's existing `X-Correlation-Id`. That same value is passed into the background job and is written to:

- `logging/access.log` for the triggering Admin HTTP request.
- `logging/api.log` for source fetch/fallback attempts, headline and image candidate counts, topic selection, visual selection/download/generation, output reservation, managed-ffmpeg setup, and ffmpeg rendering lifecycle events.
- `logging/error.log` for fatal job failures and unexpected source failures. Expected source-side 4xx blocking and individual image failures remain warning-level data in the API/scheduled-job logs.
- `logging/frontend.log` by the existing Scheduled jobs UI transaction/error logger.
- `logging/scheduled-jobs.log` for job lifecycle, source/image diagnostics, output naming, and managed-ffmpeg setup.

Fatal current-events entries now include `errorName`, `errorCode`, `errorMessage`, and `errorStack`; ffmpeg start/failure details are also written to `scheduled-jobs.log`. This prevents the previous `error:{}` records from hiding the real rendering failure.

Searching one correlation ID across these logs shows the full request-to-background-job lifecycle.

## Database migrations

No schema change is required. The existing generic `scheduled_jobs` and `scheduled_job_runs` tables already support this job and its schedule configuration. Existing schema migrations remain part of `npm install` through the unchanged `postinstall -> db:migrate -> build` flow.
