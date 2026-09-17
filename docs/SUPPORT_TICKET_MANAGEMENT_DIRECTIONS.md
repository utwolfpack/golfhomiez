# Support ticket management

## Overview

The `/support` page now stores support submissions as persistent tickets instead of treating each submission as email-only. The existing notification email to `golfhomiez@outlook.com` is retained for a newly-created ticket, while the database becomes the source of truth for the support conversation.

Users, golf-course hosts, and organizers see their own open tickets as selectable line items. When GolfHomiez admin has posted a response that the requester has not viewed, the line item displays an alert icon. Selecting a ticket marks the admin response read and opens the complete conversation. Open tickets accept additional details/replies from the requester.

Closed tickets move out of the open line-item list into **Closed support history**. A requester can continue to open and read a closed conversation, but no user reply control is rendered and the backend independently rejects attempts to add a message to a closed ticket.

## GolfHomiez admin portal

The `/golfadmin` portal has a **Support** tab alongside Golf, Tournaments, API Usage, Marketing, and Admin. It displays open/unread/closed counts, an open-ticket queue, full ticket conversations, an admin response form, and a **Close ticket** action. Closed tickets remain available for review and are read-only.

Admin opening a ticket clears its admin-unread flag. A requester reply marks the ticket unread for admin. An admin reply marks the ticket unread for the requester so the Support page can display the alert icon.

## Backend routes

Requester routes:

- `GET /api/support/tickets`
- `GET /api/support/tickets/:ticketId`
- `POST /api/support/messages` — creates a new support ticket and its first message
- `POST /api/support/tickets/:ticketId/messages` — adds requester detail to an open ticket

Admin routes (admin session required):

- `GET /api/admin/support/tickets`
- `GET /api/admin/support/tickets/:ticketId`
- `POST /api/admin/support/tickets/:ticketId/messages`
- `POST /api/admin/support/tickets/:ticketId/close`

All create/view/reply/close operations use the existing request correlation ID and write through the existing API/access/error/frontend logging pipeline.

## Database migration

`migration_scripts/20260916_090_support_ticket_management.sql` creates:

- `support_tickets`
- `support_ticket_messages`

The schema stores requester ownership, open/closed status, user/admin unread flags, messages, correlation IDs, timestamps, and close metadata. The migration is registered as `20260916_090` in `server/migrations/index.js`.

The project already runs `npm run db:migrate` from `postinstall`, so normal `npm install` deployment applies the migration in development/stage/production environments.

## Deployment paths

Copy the changed files to these project-relative paths:

- `server/index.js`
- `server/lib/support-tickets.js`
- `server/migrations/index.js`
- `migration_scripts/20260916_090_support_ticket_management.sql`
- `src/lib/support.ts`
- `src/lib/admin.ts`
- `src/pages/Support.tsx`
- `src/pages/AdminPortal.tsx`
- `src/index.css`
- `test/support-ticket-management.test.js`
- `package.json`
- `docs/SUPPORT_TICKET_MANAGEMENT_DIRECTIONS.md`

No port behavior is changed. No new npm dependency is introduced.
