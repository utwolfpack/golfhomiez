# Manual Sample Data Population Scripts

These scripts populate deterministic, realistic-looking sample data for the GolfHomiez account base used in commercials, screenshots, QA validation, and product walkthroughs.

They are manual-only scripts. They are not part of `npm install`, `postinstall`, or the automatic `db:migrate` migration runner.

## Sample accounts

Default account emails:

- Golfer user: `utwolfpack+golfhomiezuser@gmail.com`
- Host: `utwolfpack+golfhomiezhost@gmail.com`
- Organizer: `utwolfpack+golfhomiezorganizer@gmail.com`

The runner creates/updates the related profile and role rows when needed. It does not create or reset usable passwords. If a login is needed, create the password through the normal application account/password-reset flow.

## What the scripts create

### Golfer user data

`npm run data:populate:user` creates:

- 40 individual golf rounds dated from January 2025 through August 2026.
- 25 challenges.
- 15 team challenges, including skins-push examples with tied holes and visible carryover push values.
- 10 individual challenges.
- Individual challenges with participant counts ranging from 5 through 25 players.
- Realistic player/team names so the data looks appropriate for commercials and product walkthroughs.

Golfer score and challenge data only uses courses read from the `golf_courses` table. The script loads each selected course's `golf_course_holes` metadata and stores hole-level par, yardage, stroke index, tee color, and available green coordinate metadata in the generated `holes_json` payloads. If no catalog course has 18 holes with par and yardage, the script fails with a clear message instead of creating fake course names.

### Host data

`npm run data:populate:host` creates:

- A manual catalog course named `Golf Homiez Lake View` if it does not already exist.
- The course in Tooele, Utah, with 18 holes, par, yardage, rating/slope, location metadata, and a GolfHomiez public course page record.
- The public course page slug `golfhomiezlakeviewut`.
- Host account/course associations for `utwolfpack+golfhomiezhost@gmail.com`.
- 50 host-owned tournaments associated only with `Golf Homiez Lake View`.
- 35 future-dated host tournaments so published events are findable through tournament discovery/find-tournaments.
- 15 past-dated host tournaments for history and reporting views.
- Registrations, team start assignments, and completed team score records for tournament leaderboards and public course-page rollups.
- Tournament search records so published tournaments are findable through tournament discovery/find-tournaments.
- Coverage across every tournament flyer theme template.
- A mix of shotgun and tee-time starts.
- A mix of default imagery and custom tournament imagery using external golf stock images instead of files from the application project.
- 10 tournaments associated with `utwolfpack+golfhomiezorganizer@gmail.com` as organizer.
- Bulleted tournament template fields as one item per line.
- Realistic tournament names, summaries, charities, teams, and notes without labeling the content as generated data.

### Organizer data

`npm run data:populate:organizer` creates:

- A manual catalog course named `Golf Homiez Lake View` if it does not already exist.
- Organizer and host account/course associations for the sample account base.
- 10 organizer-owned tournaments associated only with `Golf Homiez Lake View`.
- 7 future-dated organizer tournaments so published events are findable through tournament discovery/find-tournaments.
- 3 past-dated organizer tournaments.
- Registrations, team start assignments, and completed team score records for the past organizer tournaments.
- Tournament search records so published tournaments are findable through tournament discovery/find-tournaments.
- Coverage across every tournament flyer theme template.
- A mix of shotgun and tee-time starts.
- A mix of default imagery and custom tournament imagery using external golf stock images instead of files from the application project.
- All organizer tournaments associated with `utwolfpack+golfhomiezhost@gmail.com` as host.
- Bulleted tournament template fields as one item per line.
- Realistic event names and descriptions for product commercials.

## How to run

From the project root, review the dry run first:

```bash
npm run data:populate:all -- --dry-run
npm run data:populate:user -- --dry-run
npm run data:populate:host -- --dry-run
npm run data:populate:organizer -- --dry-run
```

Commit the sample data after reviewing the dry-run output:

```bash
npm run data:populate:all -- --confirm
```

Run only one account type when needed:

```bash
npm run data:populate:user -- --confirm
npm run data:populate:host -- --confirm
npm run data:populate:organizer -- --confirm
```

Override target emails when a different sample user base is needed:

```bash
npm run data:populate:all -- --confirm \
  --user-email golfer@example.com \
  --host-email host@example.com \
  --organizer-email organizer@example.com
```


## Data formatting

Phone values are populated in the same human-readable format expected by the application phone inputs, for example `801 555 0100`. Tournament template bullet-list fields are stored one item per row/line so flyer and portal displays match real user-entered content. Skins-push team challenges include tied holes and carryover points so the leaderboard Push column has realistic values for commercials and QA.

## Tournament flyer imagery

When a generated tournament uses custom imagery, the runner stores external stock golf image URLs for the flyer banner, beneficiary/supporting photo, and sponsor/logo image fields. It does not reference custom images from the application project. Default-image tournaments still use the application's default template assets so both default and custom image paths can be reviewed.

## Tournament operational records

For every host and organizer tournament, the runner creates realistic registered teams with individual golfer names and emails. It also creates start assignments using the tournament's shotgun or tee-time settings. Completed past tournaments receive `tournament_team_scores` rows with hole-by-hole scoring data so completed tournament pages and leaderboard views have final results to display.

## Schema compatibility notes

The population runner writes both current and legacy role-account columns when those columns exist. Host rows include `contact_name`, `phone`, location, validation, and role-account fields so older `host_role_accounts` schemas that require `contact_name` can be populated safely. Tournament `host_account_id` values point to the host role-account id, matching the tournament foreign key used by the role-based host portal.

The host/organizer scripts create or update `Golf Homiez Lake View` in `golf_courses` and `golf_course_holes`. They also publish the related `golf_course_public_pages` row and upsert `golf_course_tournaments` rows for published GolfHomiez tournaments when those tables exist.

## Idempotency

The scripts delete prior generated rows by deterministic identifiers before repopulating. For golfer teams, the runner also resolves any existing team id by team name before deleting/recreating team members. This prevents foreign-key failures when a previous run or older seed data already created the same team name with a different id. They do not remove unrelated production user data.

## Host account schema compatibility

The host population script writes both the current course association fields and legacy required host account fields when they exist in the target database. This includes `auth_user_id`, `email`, `contact_name`, phone, location fields, validation flags, timestamps, and a deterministic legacy `password_hash` placeholder when that column exists, so `host_accounts` and `host_role_accounts` work in strict MySQL schemas where those columns do not have defaults.

## Logging

Every run prints and logs a correlation id. Search the correlation id in:

```text
logging/access.log
logging/api.log
logging/error.log
```

## Operational notes

- Run against the target environment database only after confirming the `.env` database settings.
- Do not add these commands to `postinstall`, deployment startup, or the app migration runner.
- Use `--dry-run` before `--confirm` in every environment.
- Run `npm run data:populate:host -- --confirm` before `npm run data:populate:user -- --confirm` when a brand-new environment does not yet have imported golf course metadata.
