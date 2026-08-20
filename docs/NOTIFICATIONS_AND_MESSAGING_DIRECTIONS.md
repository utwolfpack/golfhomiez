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

Both migrations are registered in `server/migrations/index.js` and are designed to be safe when deployed into an environment where the migration has already been satisfied.

## Deployment and migration execution

No production-only schema step is required during the normal dependency installation. `package.json` runs:

`npm run cleanup:project-files && npm run db:migrate && npm run build`

from `postinstall`, so migrations `20260820_075` and `20260820_076` run in development, stage, and production environments before the application build.

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
