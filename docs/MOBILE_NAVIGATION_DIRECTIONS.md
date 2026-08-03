# Mobile banner navigation

## Behavior

For authenticated golfer accounts on screens up to 720 pixels wide, the sticky GolfHomiez banner contains four compact icon buttons to the right of the Golf Homiez emblem:

- **Challenges** opens `/challenges`.
- **My Scores** opens `/my-golf-scores` with an add-score icon.
- **My Tournaments** opens `/my-tournaments`.
- **Golf Homiez user** opens the existing account dropdown.

The account icon replaces the visible signed-in email address in mobile view. The email-based account trigger remains unchanged on wider screens. Admin, host, and organizer sessions do not receive the three golfer shortcuts; their account dropdown remains available through the compact user icon on mobile.

All icon buttons retain accessible labels and keyboard navigation. The active golfer destination receives a stronger banner highlight.

## Logging

Mobile shortcut selections are written through the existing frontend logger with category `app.nav.mobile`. Account-menu changes use category `app.nav`. Both include the existing correlation ID so navigation can be traced with related access and frontend log entries.

## Deployment

Copy these files into the same paths in the application:

- `src/components/NavBar.tsx`
- `src/index.css`
- `test/app.test.js`
- `docs/MOBILE_NAVIGATION_DIRECTIONS.md`

No database migration, port change, environment variable, or npm package is required.
