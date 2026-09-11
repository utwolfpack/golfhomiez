# Create Short-form Great Shots - Small

## Purpose

`Create Short-form Great Shots - Small` is registered in the existing GolfHomiez Admin **Scheduled jobs** page. It defaults to **Manual**, can use the existing Daily/Weekly/Monthly scheduler controls, and runs as cancellable background work when started manually.

Each successful run creates a vertical 720x1280 H.264 GolfHomiez commercial from free, commercially reusable internet-sourced golf-shot video. A **professional + amateur mixed pair is preferred** whenever both complete clips fit inside the 30-second commercial maximum.

If the free catalog cannot supply an unused mixed pair that fits within 30 seconds, the job uses a **single-clip fallback** instead of failing. The fallback still uses the complete qualifying golf-shot video and alternates the preferred professional/amateur category across fallback runs using the existing no-reuse history. This keeps the commercial series mixed over time while avoiding the `GREAT_SHOT_MIX_UNAVAILABLE` dead-end seen when one valid professional clip and one valid amateur clip cannot both fit in the same 30-second file.

The job preserves the **full qualifying source videos** instead of cutting each source to three seconds. The finished commercial can therefore vary in length, but it can never exceed **30 seconds total**. Every source video is rejected if its actual downloaded duration is greater than 30 seconds, shorter than two seconds, or cannot be determined. A mixed pair is used only when the sum of both full durations is 30 seconds or less.

GolfHomiez overlays, short humor, source attribution, the GolfHomiez emblem, and `golfhomiez.com` remain visible without hiding the shot. The closing call to action appears during the final three seconds of the resulting commercial.

## More selective golf-shot matching

The source search is intentionally selective. The candidate must provide evidence that it is a real person playing golf and making a specific shot. Candidate title, description, source categories/subjects, and the job's controlled search context are evaluated for:

- golf/golfer context;
- a shot action such as a drive, tee shot, approach, putt, chip, hole-in-one, or similar stroke;
- a person/player signal; and
- either a memorable great/funny moment or professional/tour context.

Normal search results for amateur footage must include a memorable signal such as a hole-in-one, trick shot, funny/lucky shot, long putt, long drive, yips, chip-in, unusual bounce, or similar event. A small curated Wikimedia seed set may also be accepted when the exact source has been pre-reviewed as a real person completing a golf swing/shot and its license and duration are revalidated at run time. Generic course footage or an unverified practice listing is not enough.

The job rejects obvious non-shot content such as drone/flyover footage, course tours, animation/gameplay, podcasts, interviews, equipment reviews, lessons/tutorials, documentaries, trailers, advertisements, and promotional-only content.

Wikimedia requests use TimedMediaHandler `videoinfo` metadata so the source duration can be known before download when available. Every selected file is still checked again against the downloaded media with ffmpeg before rendering. If a downloaded candidate is actually too long or cannot be validated, the job rejects that candidate and tries the next qualifying selection plan—another mixed pair first, then an eligible single-clip fallback—instead of failing immediately.

## Internet video sources and licensing

The job uses **free sources only**. It uses providers that expose downloadable video files and licensing information suitable for automated commercial creation. It does **not** scrape arbitrary social-media videos, use paid stock-video services, or download normal YouTube/PGA/LPGA clips without reusable rights.

Supported runtime sources are:

- **Pexels Videos (primary)** — free API access with `PEXELS_API_KEY`. The job searches the documented `GET https://api.pexels.com/v1/videos/search` endpoint with eight focused golf-shot queries covering professional/pro-style tee shots, competition swings/drives, amazing shots, trick shots, putts, and celebrations. It requests 50 results per query (well below the documented 80-result maximum), keeps only direct MP4 files returned by the API, prefers portrait renditions when available, rejects source durations outside 2–30 seconds, and gives qualifying Pexels footage the highest provider-selection priority. The Pexels video ID is used for no-reuse history, while creator, creator URL, Pexels page URL, and Pexels License URL are retained for attribution/audit history. A missing, invalid, or rate-limited Pexels key is recoverable; the job logs the condition and continues to the no-key providers below.
- **Wikimedia Commons** — enabled without an API key. The job now uses three independent discovery paths: curated known golf-shot titles, direct MediaWiki category enumeration for `Category:Videos of golf`, `Category:Swing (golf)`, `Category:Videos of sports training`, and `Category:2008 Women's British Open`, plus broader targeted `filetype:video` searches. Category enumeration uses `categorymembers`, then fetches `videoinfo` and license metadata in batches for the discovered video files. Search discovery now follows MediaWiki continuation for up to three result pages per query instead of considering only the first 50 results; this reduces false catalog exhaustion while keeping request volume bounded. Every result is revalidated at run time and must be an actual video file with Public Domain, CC0, or CC BY rights. Wikimedia files can be dual-licensed, so the resolver now accepts an explicit CC BY/CC0/Public Domain alternative even when Commons also reports GFDL for the same file. It checks `LicenseUrl`, `LicenseShortName`, `UsageTerms`, `License`, and license categories such as `CC-BY-4.0`. Noncommercial, no-derivatives, share-alike, GFDL-only, and ambiguous licenses are rejected. TimedMediaHandler duration is read from the normal video fields and from `commonmetadata`/`metadata` when necessary.
- **Mixkit Free License** — enabled without an API key. The job reads only the bounded Mixkit golf/golf-swing catalog plus a small curated set of known golf item pages, then validates the individual item page before it can become a candidate. The item must explicitly say `Mixkit Stock Video Free License`; `Mixkit Restricted License` and personal-use-only items are rejected. The page must describe a real person/golfer performing a golf action, must not match virtual-reality/tutorial/promo/non-shot exclusions, and must report a duration from 2 through 30 seconds. At most 30 Mixkit item pages are evaluated per run with bounded concurrency, and only a finally selected source video is downloaded. The job uses only direct MP4 URLs actually published by the item page. It no longer fabricates `-large.mp4`/`-small.mp4` preview URLs because Mixkit's asset CDN returns HTTP 403 for those guessed server-side URLs. If a page does not expose a server-downloadable MP4, that item is skipped.
- **Internet Archive** — enabled without an API key. Archive search-index rows are not required to contain `licenseurl`, because many otherwise usable items expose licensing only in the item metadata response. The job keeps an index hit when its search-level license is absent, then requires the authoritative item metadata to prove Public Domain, CC0, or CC BY before the item can become a candidate. Explicitly restricted search hits are still discarded immediately. A supported downloadable video file must also remain within the configured size limit. The item identifier, source page, creator, and license are retained for attribution/audit history.

The scheduled job now calls **Pexels first when `PEXELS_API_KEY` is configured**. Pexels remains a free content/API source; it simply requires account authentication for API requests. Pixabay and paid stock providers are not used. Mixkit candidates are accepted only when the individual page explicitly carries the Mixkit Stock Video Free License; Restricted License items are not used.

### Guaranteed free fallback when providers are blocked or exhausted

External free catalogs remain preferred, but the job no longer fails solely because a provider blocks server-side video downloads or because every unused free clip has been exhausted. After all qualifying external plans fail, the job creates a unique GolfHomiez-generated golf replay clip locally and uses that as the commercial source.

The generated fallback:
- uses the existing ffmpeg runtime and locally generated GolfHomiez golf artwork;
- requires no API key, paid media, browser automation, or new npm package;
- creates a new unique video key for every run, so the no-reuse history remains meaningful;
- is explicitly recorded with provider `GolfHomiez` and selection mode `generated-fallback`; and
- is used only after free external footage cannot be downloaded and validated.

Repeated Mixkit or Pexels media-download HTTP 401/403 responses are treated as provider access blocking. After two such candidate failures from one provider in one run, further downloads from that provider are skipped and the selector continues/falls back instead of repeatedly hitting the same blocked CDN.


Operators should still review provider terms and the finished commercial before public ad distribution, especially when footage depicts recognizable professional golfers. The source URL, author, provider, license, and validated duration are preserved in each scheduled-job run output for auditing.


## Scheduled jobs metadata and latest MP4 download

The Admin **Scheduled jobs** row for Great Shots displays the latest Pexels quota observed by either commercial job. Successful Pexels responses provide monthly request-limit metadata, which GolfHomiez stores as `pexelsQuota` in the run output. The UI shows remaining/total requests, requests used, reset time, and the time that usage was observed. Loading or refreshing the Scheduled jobs page does not spend an extra Pexels request merely to obtain quota information.

The row also exposes the latest successful Great Shots MP4 with file name, duration, resolution, file size, completion time, selection mode, Pexels clip count, and source providers. `Download latest MP4` uses an Admin-authenticated server endpoint and is restricted to `.mp4` files physically located under `jobs/commercials`. If the newest run fails, the most recent successful MP4 remains downloadable.

Pexels quota is account-wide, so the Great Shots, Funny Shots, and Current Events rows intentionally show the same latest observed quota when the jobs use the same `PEXELS_API_KEY`.

## Never reuse a video

Successful scheduled-job runs already persist their output JSON in `scheduled_job_runs`. This job uses that existing history instead of adding another table.

Before selecting footage, the job reads up to the last 2,000 successful runs for `createShortFormGreatShotsSmall`, collects every prior `videos[].key`, and removes those keys from the current candidate pool. A video is not marked used until a run successfully creates its MP4 because its identity is written as part of the normal completed run output. When a single-clip fallback is required, the parity of that used-key history alternates the preferred professional/amateur category so repeated fallback runs do not drift permanently to one type.

This means the same provider video identity will not be selected again by this job after a successful use.

No schema change is required for reuse tracking.

## Output directory and filename

The output directory is:

`jobs/commercials`

The first run on a date uses:

`Create Short-form Great Shots - Small - GreatShotShort - YYYY-MM-DD.mp4`

If that name already exists, the job increments it rather than overwriting anything:

- `Create Short-form Great Shots - Small - GreatShotShort - YYYY-MM-DD - 2.mp4`
- `Create Short-form Great Shots - Small - GreatShotShort - YYYY-MM-DD - 3.mp4`
- and so on.

A temporary `.lock` file reserves the destination. ffmpeg renders to a temporary file and the finished MP4 is copied using exclusive-create semantics, so an existing file cannot be replaced by a concurrent or repeated run.

`jobs/*` runtime content remains ignored by Git while `jobs/.gitkeep` and `jobs/commercials/.gitkeep` preserve the required directory structure.

## ffmpeg

This job uses the same existing ffmpeg runtime support as the current-events commercial job:

1. configured `FFMPEG_PATH`;
2. the GolfHomiez-managed pinned/checksummed ffmpeg runtime;
3. host `ffmpeg`; and
4. automatic verified runtime setup when enabled.

No new npm video-generation dependency is introduced.

Before rendering, ffmpeg probes every downloaded source file and reads the actual duration. The file is rejected when the duration is unknown, less than two seconds, or more than 30 seconds. A mixed pair is rejected if the two validated full durations together exceed 30 seconds; the selector then continues through other mixed plans and finally eligible single-clip fallbacks.

The renderer supports either one or two qualifying clips and uses each selected video from `start=0` through its validated full duration. It no longer takes a three-second middle excerpt or pads a source to a fixed length.

Before concatenation, both source clips are normalized to 720x1280, 30 fps, yuv420p, and square pixels (`setsar=1`). This prevents ffmpeg concat failures when downloaded videos carry different sample-aspect-ratio metadata even after being scaled to the same dimensions.

The renderer also supplies `drawtext` with an explicit local font file instead of relying on ffmpeg/fontconfig defaults. On Windows it automatically checks standard Windows font locations; Linux and macOS system-font locations are also supported. `GREAT_SHOTS_FONT_FILE` can explicitly point to a readable `.ttf`, `.otf`, or `.ttc` font when needed.

## Background music

Great Shots now includes subtle background audio from **Golf Homiez for Golf Courses**, matching the Funny Shots commercial job. The bundled source is `server/assets/golf-homiez-for-golf-courses-background.m4a`, derived from the existing GolfHomiez golf-course marketing commercial. ffmpeg mixes the track at the intentionally subtle default gain `0.12`, adds short fade-in/fade-out transitions, and maps it as AAC audio in the final MP4 instead of emitting a silent (`-an`) video.

`COMMERCIAL_BACKGROUND_MUSIC_FILE=` can override the bundled asset, and `COMMERCIAL_BACKGROUND_MUSIC_VOLUME=0.12` can adjust the mix within the guarded 0.02-0.35 range. The completed run output records the music name, file name, and applied volume.

## Environment configuration

Pexels is the preferred free source and requires one account-scoped API key. Add this to the server `.env` file:

`PEXELS_API_KEY=<your Pexels API key>`

Pexels issues the key immediately after the account owner signs in and requests it at `https://www.pexels.com/api/key/`. Do not commit the real key to source control and do not place it in client/Vite variables. The server sends it only in the Pexels API `Authorization` header. If the variable is blank, invalid, or Pexels is temporarily unavailable, the job continues with Wikimedia Commons, Mixkit Free License, Internet Archive, and finally the GolfHomiez-generated fallback.

One normal discovery run performs at most eight Pexels search requests. The job does not add the Pexels JavaScript SDK or any other npm dependency; it uses the existing server-side `fetch` implementation directly.

Runtime limits:

- `PEXELS_API_KEY=` — required only to enable the preferred Pexels source. Keep this secret server-side.
- `GREAT_SHOTS_FETCH_TIMEOUT_MS=15000` — metadata/API request timeout; accepted range 1,000-60,000 ms.
- `GREAT_SHOTS_VIDEO_TIMEOUT_MS=30000` — selected source-video download timeout; accepted range 1,000-120,000 ms.
- `GREAT_SHOTS_MAX_VIDEO_BYTES=62914560` — maximum downloaded source-video size; accepted range 1 MB-150 MB.
- `GREAT_SHOTS_FONT_FILE=` — optional local font file override. Leave blank for automatic platform font discovery.
- `COMMERCIAL_BACKGROUND_MUSIC_FILE=` — optional override for the bundled Golf Homiez for Golf Courses audio track.
- `COMMERCIAL_BACKGROUND_MUSIC_VOLUME=0.12` — subtle background-music mix; accepted range 0.02-0.35.

The 30-second limit is an application safety/content rule rather than an environment setting, so deployments cannot accidentally configure the job to exceed it.

Existing `FFMPEG_PATH`, `FFMPEG_AUTO_DOWNLOAD`, and `FFMPEG_DOWNLOAD_TIMEOUT_MS` settings are reused.

## Logging and correlation

The triggering Admin request correlation ID flows into the background scheduled job. Event names include:

- `great_shots_commercial_started`
- `great_shots_source_fetch_started`
- `great_shots_source_fetch_completed`
- `great_shots_source_fetch_failed`
- `great_shots_wikimedia_category_discovered`
- `great_shots_discovery_request_failed`
- `great_shots_selection_diagnostics`
- `great_shots_source_skipped`
- `great_shots_video_download_started`
- `great_shots_video_download_completed`
- `great_shots_video_download_url_failed`
- `great_shots_generated_fallback_selected`
- `great_shots_generated_fallback_completed`
- `great_shots_generated_fallback_started`
- `great_shots_external_validation_exhausted`
- `great_shots_external_catalog_exhausted`
- `great_shots_provider_download_blocked`
- `great_shots_video_duration_validated`
- `great_shots_candidate_rejected`
- `great_shots_pair_rejected_too_long`
- `great_shots_single_fallback_selected`
- `great_shots_videos_selected`
- `great_shots_output_reserved`
- `great_shots_ffmpeg_started`
- `great_shots_ffmpeg_completed`
- `great_shots_commercial_completed`
- `great_shots_commercial_failed`

Individual Pexels searches, Wikimedia category/search/seed requests, Mixkit catalog/item requests, and Internet Archive search/metadata requests are recoverable. A failed request is logged as `great_shots_discovery_request_failed`, while successful requests from the same source continue contributing candidates instead of discarding the entire source result set.

When selection cannot find an unused eligible clip, `great_shots_selection_diagnostics` records the number of unique videos discovered, how many are already used, how many remain inside the metadata duration limit, how many have unknown metadata duration, how many are already known to exceed 30 seconds, eligible professional/amateur counts, providers, and a small sample of unused titles. The thrown `GREAT_SHOT_VIDEO_UNAVAILABLE` message includes the same aggregate counts so source exhaustion and content-filtering failures can be distinguished without guessing.

Fatal Great Shots entries now include `errorName`, `errorCode`, `errorMessage`, and `errorStack`; ffmpeg failures are also copied to `scheduled-jobs.log` so the scheduled-job log no longer collapses the useful error into `error:{}`.

The common correlation ID can be searched across the application's existing `logging/access.log`, `logging/api.log`, `logging/error.log`, `logging/frontend.log`, and `logging/scheduled-jobs.log` lifecycle. The existing Scheduled jobs frontend already records its transaction/error activity, so no additional page-specific frontend logger is required.

## Database migrations and npm install

No schema change is required. The existing `scheduled_jobs` and `scheduled_job_runs` tables already support registration, scheduling, run history, correlation IDs, output JSON, validated source durations, and no-reuse tracking.

The existing installation flow remains unchanged and continues to run migrations through `npm install`:

`postinstall -> cleanup:project-files -> db:migrate -> build`

## Automated social publishing

When `SOCIAL_AUTO_PUBLISH=true`, a successful MP4 is handed to the shared social publisher for Facebook, Instagram, LinkedIn, and YouTube. Credentials come from the server `.env` file, transient failures retry automatically, and a social-network failure does not turn a successfully generated MP4 run into a failed scheduled job. See `docs/SOCIAL_COMMERCIAL_PUBLISHING.md` for provider setup and token lifecycle details.
