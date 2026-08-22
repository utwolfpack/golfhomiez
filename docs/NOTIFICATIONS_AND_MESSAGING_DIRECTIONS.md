# Notifications and Messaging Implementation

## Overview

The golfer inbox is a unified **Notifications** page for direct golfer messages, group conversations, challenges, and tournament messages. Notifications are ordered by most recent activity and paginated at 10 conversations per page.

The host and organizer tournament builder now uses checkbox-driven registered-player messaging with a shared tournament dialogue history. Golfers can reply to tournament messages from the inbox, and a golfer reply is visible to everyone who was included in the original tournament message while only the tournament host receives a new portal unread notification.

## Application paths

- Golfer notifications page: `/inbox`
- Challenge notification links: `/challenges?thread=<thread-id>`
- Tournament notification links: `/tournaments/<tournament-identifier>`
- Host tournament messaging: edit a tournament in `/host/portal`
- Organizer tournament messaging: edit an invited tournament in `/organizer/portal`

## Host and organizer tournament messaging

`src/components/TournamentMessagingPanel.tsx` provides the shared host/organizer experience:

- The section title/action is **Send a message**.
- Registered golfers are selected with the checkboxes in the tournament player list.
- There is one send action; only checked golfers receive the new message.
- **Select all** is a selection helper and does not bypass the checkbox recipient list.
- The primary send button uses a rounded, mobile-friendly presentation.
- **Tournament messages** appears above the registered-golfer count on the right side of the section.
- When the host has unread golfer replies, a bell and unread count appear beside **Tournament messages**. No bell is displayed when there are no unread messages.
- Opening **Tournament messages** shows a modal containing each conversation, the original recipients, timestamps, all dialogue, and a reply action.
- Opening the modal marks the host's portal tournament-message notifications read.

Organizer users can view and participate in the shared tournament dialogue. Per the notification requirement, golfer replies increment the host's unread count rather than generating a separate organizer unread notification.

## Golfer tournament dialogue

Tournament notifications in `/inbox` support two-way messaging:

- A golfer can reply to a tournament message initiated by the host/organizer.
- A golfer can start a message to the host from a tournament notification that predates the shared dialogue implementation.
- Each initial host/organizer send creates one shared conversation for the selected recipients.
- A golfer reply is stored once in that shared conversation, so every golfer who was part of the original recipient set can see the reply when viewing the thread.
- A golfer reply does **not** create new inbox notification rows for the other golfers in the original recipient set.
- The host portal unread count is derived from new golfer messages in the shared conversation.
- Host/organizer replies are written to the shared conversation and create tournament inbox notifications for the original recipient set.

## Groups link behavior

The Message groups section is hidden when `/inbox` first loads. A **Groups** link/button in the notification toolbar reveals the group-management section; selecting it again hides the section.

Existing group rules remain in place:

- The group creator can add and remove members.
- A member added later sees group content only from their join time forward.
- A removed member keeps the conversation through the removal event, cannot send additional messages, and cannot see later group content.
- Group threads remain one notification line item per group conversation.

## Main implementation files

### Front end

- `src/pages/Inbox.tsx` — unified notifications UI, filters, pagination, tournament dialogue/replies, hidden-by-default Groups section with scroll/focus behavior, group-recipient count indicators for multi-golfer tournament messages, read/delete/restore, direct messages, and group management.
- `src/lib/notifications.ts` — notification/group APIs plus golfer tournament-conversation APIs.
- `src/lib/inbox.ts` — inbox message model including tournament-conversation metadata.
- `src/components/NavBar.tsx` — unread-notification bell/count in the golfer banner plus a Notifications account-menu link immediately above Profile.
- `src/components/TournamentMessagingPanel.tsx` — checkbox-driven tournament messaging, collapsed-by-default Send a message disclosure, history modal with focus moved to the top when opened, unread indicator, and replies for host/organizer portals.
- `src/lib/accounts.ts` — host/organizer tournament-message API client and dialogue models.
- `src/pages/HostPortal.tsx` — host portal integration with collapsed-by-default Teams signed up and Tournament Info disclosures and no list-heading text above the active tournament editor.
- `src/pages/OrganizerTournaments.tsx` — organizer portal integration with collapsed-by-default Teams signed up and Tournament Info disclosures.
- `src/pages/Challenges.tsx` — opens a challenge directly from a challenge notification.
- `src/pages/Profile.tsx` — profile navigation uses Notifications terminology.
- `src/index.css` — responsive notification, group, tournament-message modal, unread bell, and rounded send-button styles.

### Back end

- `server/lib/notification-service.js` — notification aggregation, per-user state, group history rules, shared tournament conversations, participant access, portal unread state, and replies.
- `server/index.js` — notification/group routes, host/organizer tournament-message history/send/reply routes, golfer tournament-message routes, registration notifications, and correlated logging.
- `server/storage/mysql.js` — maps notification metadata, including `tournament_conversation_id`.

## Database migrations

### `20260820_075_notifications_groups_and_tournament_messaging.sql`

Adds the unified notification and group-messaging schema:

- extends `inbox_messages` for group/tournament/correlation metadata;
- changes `message_type` to a forward-compatible `VARCHAR(32)`;
- adds per-user thread read/delete state;
- adds message groups and time-bounded group membership;
- adds indexes for group, tournament, and correlation-ID lookups.

### `20260820_076_tournament_message_dialogue.sql`

Adds shared tournament dialogue support:

- `inbox_messages.tournament_conversation_id`;
- `tournament_message_threads`;
- `tournament_message_thread_members`;
- `tournament_message_entries`;
- `tournament_message_portal_state`;
- indexes for conversation, participant, chronological-message, and correlation-ID lookups.

Migrations `20260820_075`, `20260820_076`, and challenge migration `20260822_077` are registered in `server/migrations/index.js` and are designed to be safe when deployed into an environment where the migration has already been satisfied.

## Deployment and migration execution

No production-only schema step is required during the normal dependency installation. `package.json` runs:

`npm run cleanup:project-files && npm run db:migrate && npm run build`

from `postinstall`, so migrations `20260820_075`, `20260820_076`, and `20260822_077` run in development, stage, and production environments before the application build.

For an explicit migration-only deployment step, run:

`npm run db:migrate`

No port values were added or hardcoded by this work. The server continues to use the existing `process.env.PORT` configuration.

## Logging and correlation IDs

The implementation extends the existing correlation-ID logging rather than introducing a parallel logger. Notification loads/actions, group actions, tournament history loads, read-state updates, sends, replies, and golfer-to-host messages are logged with the request correlation ID.

Front-end actions and failures use the existing front-end logger. The existing separate log files remain:

- `logging/access.log`
- `logging/api.log`
- `logging/frontend.log`
- `logging/error.log`

Searching the same correlation ID across those files reconstructs the request lifecycle from browser action through API processing and errors.

## Security and dependency notes

No new npm dependency was added for these notification/tournament-message features. Existing dependency-security tests verify the patched `brace-expansion` and `nanoid` lockfile versions and dependency constraints intended to prevent reintroducing the known high-severity versions.

## Challenge enhancements — 2026-08-22

`src/pages/Challenges.tsx` now treats challenge location independently from any device/location setting. When the create form opens, the State field defaults from the signed-in golfer's profile `primaryState`. For Team Challenges a course remains required. For Individual Challenges a course is optional; leaving **Use a specific golf course (optional)** unchecked allows each invited golfer to participate without being tied to the creator's course.

Individual Challenge creation now follows the validated-member flow used by Create Team. The creator is shown first, each additional golfer has an email field plus **Validate** and **Remove**, validated GolfHomiez users display their name, and **+ Add member** adds another entry. When validation does not find a GolfHomiez account, `InviteHomieModal` opens so the creator can send a GolfHomiez registration invitation. The invited email is still retained as an Individual Challenge participant.

After an Individual Challenge is created, its creator can see the invited-golfer list and continue validating/adding golfers until the challenge is completed. Existing GolfHomiez users added to the challenge receive challenge inbox activity through the shared Individual Challenge thread. Pending invitees are represented by email so they can participate after registering with the same address.

Individual Challenges use a start and end date with a maximum one-month range. The challenge creator can edit the date range and tee selection until completion. Team Challenge creators can edit tee selection, Team Challenge game, and points per hole until completion. Completion locks these settings and the add-golfer flow.

Opening **Create Challenge** hides all other challenge line items until the create form is closed. Opening an existing challenge continues to isolate that challenge. Individual Challenge leaderboards exclude invited golfers who have not entered any score/hole data; a no-participation message is shown until at least one golfer participates.

### Challenge API and persistence

- `PATCH /api/inbox/messages/:id/challenge-settings` updates active challenge settings for the challenge creator.
- `POST /api/inbox/messages/:id/individual-participants` adds a golfer to an active Individual Challenge for the creator and adds challenge inbox activity to the thread.
- `inbox_messages.challenge_end_date` persists the Individual Challenge end date.
- `individual_participants_json` remains the source for invited golfers and their score participation state.

Migration `migration_scripts/20260822_077_individual_challenge_date_range.sql` adds `challenge_end_date`. The SQL file checks `information_schema` before altering the table, and migration `20260822_077` in `server/migrations/index.js` independently checks for the column before returning SQL. This makes the schema change safe to apply through the normal migration runner in development, stage, and production.

Challenge create/member validation, profile-state defaulting, optional-location changes, settings updates, invite actions, and add-participant transactions use the existing front-end/API correlation logging. Server events include `challenge_settings_update_started`, `challenge_settings_update_succeeded`, `individual_challenge_member_add_started`, and `individual_challenge_member_add_succeeded`; request context carries the correlation ID into the existing access/API/error logging lifecycle.

## 2026-08-22 Individual Challenge participant follow-up

Individual Challenge participant information is refreshed against the current GolfHomiez user directory whenever an Individual Challenge is selected and again before its leaderboard opens. If an invited email address has since registered, the stored participant record is updated with the registered user ID and current display name. The UI then removes the `Invitation pending` badge and uses the registered golfer name in the invited-golfer list and leaderboard. Registered golfers no longer display a separate `GolfHomiez golfer` badge.

The Individual Challenge count beneath each challenge line item is a button. Selecting it opens the challenge golfer list and refreshes registration state before presenting the participants. Pending invitees retain the `Invitation pending` badge; registered golfers display their current name and email without an extra status badge.

Individual Challenge leaderboard rows now require at least one saved hole (`thru > 0`). A participant with no saved hole is omitted even if an older aggregate score value exists. This keeps the leaderboard limited to golfers who have actually started the challenge round.

No database schema change is required for this follow-up. The existing `individual_participants_json` payload stores the refreshed user ID and display name, and the existing npm-install migration sequence remains unchanged.

Participant-directory refreshes are logged on both the frontend and API with the existing correlation ID. Search for `individual_challenge_participant_status_refresh_*` in `frontend.log` and `individual_challenge_participant_refresh_*` in `api.log`/`error.log` to trace the request lifecycle.

## 2026-08-22 Challenge and Solo Logger display follow-up

- Individual Challenge activity rows that only state that a golfer "was invited to the Individual Challenge" are treated as system membership activity and are not rendered in the Challenges conversation. The participant remains part of the challenge and keeps normal inbox/challenge access.
- Individual Challenge line items no longer repeat the generic "Individual Challenge" title above the date/course metadata. The score area no longer displays the "Individual Challenge Score" heading above the Leaderboard action.
- The active Individual Challenge action label is "Say Something" instead of "Reply".
- Solo Logger no longer enables nearest-course/device-location defaults. It loads `/api/profile` and resolves the golfer's `primaryState` against the available golf-course states, then defaults the State selector to that profile state. If a profile state is unavailable or cannot be resolved, the first available course state is used without geolocation.
- Frontend diagnostics include `solo_profile_state_loaded`, `solo_profile_state_load_failed`, `solo_state_defaulted_from_profile`, and `solo_state_defaulted_to_available_fallback`, all using the existing correlation ID logger. No schema change or new migration is required for this follow-up.
