# Create Short-form Funny Shots - Small

## Purpose and scheduling

`Create Short-form Funny Shots - Small` follows the same Admin **Scheduled jobs** format as `Create Short-form Great Shots - Small`. It defaults to **Manual**, can use the existing Daily/Weekly/Monthly scheduling controls, runs as cancellable background work, records correlated API/scheduled-job logging, stores normal run output in `scheduled_job_runs`, and exposes the latest successful MP4 for Admin download.

The output is a vertical GolfHomiez commercial built from **unused Pexels videos of funny golf shots**. The job is intentionally separate from Great Shots so a Funny Shots success does not consume Great Shots no-reuse history and vice versa.

## Pexels funny-golf discovery

The job uses the shared server-side `PEXELS_API_KEY` and searches Pexels Videos with focused terms such as:

- `funny golf fail golfer`
- `golfer misses ball funny`
- `funny golf swing golfer`
- `golf shank funny golfer`
- `funny golf trick shot`
- `golfer funny reaction shot`

Candidates must be Pexels video results and must contain golf, shot/action, person/golfer, and funny/fail/reaction evidence across the Pexels page description and the controlled search query. Generic drone/flyover footage, empty-course footage, tutorials, equipment reviews, simulations, interviews, advertising, and other non-shot material are rejected.

Each candidate must be between **2 and 30 seconds**. Pexels metadata is used as an initial filter, but the downloaded MP4 is also probed with ffmpeg before use. A source that is actually longer than 30 seconds is never shortened just to fit the job; it is rejected and another source is tried.

The selector prefers two unused funny clips when the complete validated durations fit within the 30-second commercial maximum. Otherwise it uses the best single full qualifying clip. Successful `videos[].key` values are read from prior `createShortFormFunnyShotsSmall` runs so the same Pexels video is not reused.

## Background music

Both Funny Shots and Great Shots include subtle background audio from **Golf Homiez for Golf Courses**. The bundled server asset is:

`server/assets/golf-homiez-for-golf-courses-background.m4a`

It was derived from the existing `GolfHomiez_Golf_Course_Commercial_60s.mp4` GolfHomiez marketing artifact. The rendered commercial uses the track as background audio at a default mix level of `0.12` (about -18 dB relative gain) with short fade-in/fade-out transitions. Source-video audio is not mixed into the commercial, so the GolfHomiez background track remains consistent.

Optional server settings:

- `COMMERCIAL_BACKGROUND_MUSIC_FILE=` — leave blank to use the bundled track.
- `COMMERCIAL_BACKGROUND_MUSIC_VOLUME=0.12` — accepted range `0.02` through `0.35`.

## Output format

The first output for a date is:

`jobs/commercials/Create Short-form Funny Shots - Small - FunnyShotShort - YYYY-MM-DD.mp4`

Existing files are never overwritten. Later runs use ` - 2.mp4`, ` - 3.mp4`, and so on.

The video is normalized to:

- 720x1280 portrait
- 30 fps
- square sample aspect ratio (`setsar=1`)
- H.264 / yuv420p video
- AAC background audio
- fast-start MP4 metadata
- maximum 30 seconds total

The overlays use the Great Shots visual format but funny-specific copy: `FUNNY SHOT`, `GOLF HAPPENS.`, and a closing GolfHomiez CTA.

## Scheduled Jobs Admin metadata

The Funny Shots row uses the same commercial metadata card as Great Shots and Current Events. It displays:

- latest observed Pexels `remaining / limit` quota;
- requests used, reset time, and usage-observed time when returned by Pexels;
- the latest successful MP4 filename, duration, resolution, file size, and completion time;
- `Download latest MP4` through the Admin-authenticated scheduled-job output endpoint;
- selection mode and Pexels clip count;
- `Content: funny golf shots`;
- `Music: Golf Homiez for Golf Courses`.

The quota is account-wide because all three commercial jobs use the same `PEXELS_API_KEY`. Refreshing the Admin page does not spend an extra Pexels request only to obtain quota metadata.

## Environment configuration

Required to retrieve Pexels footage:

`PEXELS_API_KEY=<your Pexels API key>`

Additional optional limits:

- `FUNNY_SHOTS_FETCH_TIMEOUT_MS=15000`
- `FUNNY_SHOTS_VIDEO_TIMEOUT_MS=30000`
- `FUNNY_SHOTS_MAX_VIDEO_BYTES=62914560`
- `GREAT_SHOTS_FONT_FILE=` — Funny Shots reuses the same explicit/platform font resolver as Great Shots.
- `COMMERCIAL_BACKGROUND_MUSIC_FILE=`
- `COMMERCIAL_BACKGROUND_MUSIC_VOLUME=0.12`

The Pexels key remains server-side and must not use a `VITE_` prefix.

## Logging and correlation

The triggering Admin correlation ID flows into the job. Important event names include:

- `funny_shots_commercial_started`
- `funny_shots_source_fetch_completed`
- `funny_shots_source_fetch_failed`
- `funny_shots_selection_diagnostics`
- `funny_shots_video_download_completed`
- `funny_shots_video_duration_validated`
- `funny_shots_candidate_rejected`
- `funny_shots_output_reserved`
- `funny_shots_ffmpeg_started`
- `funny_shots_ffmpeg_completed`
- `funny_shots_commercial_completed`
- `funny_shots_commercial_failed`

Pexels quota observations use the existing `pexels_api_quota_observed` event. The common correlation ID can be searched through access, API, error, frontend, and scheduled-job logs.

## Database and installation

No schema change is required. The existing `scheduled_jobs` and `scheduled_job_runs` tables already support definition upsert, schedule configuration, run history, output JSON, correlation IDs, latest-output metadata, and no-reuse history.

The existing installation flow remains unchanged:

`postinstall -> cleanup:project-files -> db:migrate -> build`
