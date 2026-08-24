# Challenge Exit and Notification Reply Changes

## Summary

This update refines the Challenges page and adds direct challenge replies to the Notifications page.

### Challenges page

- The former **Close details** action is now **Exit Challenge**.
- **Exit Challenge** uses a soft light-red treatment so it is visually distinct from challenge actions.
- **Complete Challenge** and **Delete Challenge** are placed below **Exit Challenge**.
- Challenge Settings, Challenge Score, and Challenge Discussion remain independent sibling sections and are collapsed by default.
- Opening one section hides the other section links until the open section is collapsed.
- While a challenge section is open, Complete Challenge and Delete Challenge are hidden to keep the user focused on the active section.
- Individual Challenge discussion copy now uses:
  - **Say something to your challenge group**
  - **Smack talk your homiez**
  - **Send**
- The Individual Challenge reply character counter is no longer shown. Backend message length validation remains unchanged.

### Notifications page

- Active Team Challenge and Individual Challenge notifications can now be replied to directly from the expanded notification.
- The reply uses the existing inbox challenge-thread API, so the same challenge participant and completion rules apply as on the Challenges page.
- Completed challenge notifications do not show the reply composer.
- Individual Challenge notifications use **Say something to your challenge group** and the **Smack talk your homiez** placeholder.
- The direct-reply layout is optimized for narrow/mobile screens with a full-width textarea and Send button.

## Logging

The update continues to use the existing correlation-ID logging lifecycle.

New frontend events include:

- `exit_challenge_clicked`
- `challenge_section_expanded` / `challenge_section_collapsed` with sibling-link visibility state
- `notification_challenge_reply_started`
- `notification_challenge_reply_succeeded`
- `notification_challenge_reply_failed`

Challenge replies continue through `POST /api/inbox/messages`, whose API logging records the same request correlation ID and challenge-thread identifiers. This allows a transaction to be followed through `access.log`, `api.log`, `frontend.log`, and `error.log`.

## Database and deployment

No schema changes are required for this update, so no new migration is needed. Existing migrations continue to run through the project's current `npm install` / `postinstall` migration process.

No port configuration was changed and no port value was hardcoded.

## Dependency security

No npm dependency is added by this update. The existing dependency-security tests remain part of the normal test suite.
