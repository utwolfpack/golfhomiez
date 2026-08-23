# Challenge Message and Profile Name Updates

## Individual Challenge message

The Challenge Message field on `src/pages/Challenges.tsx` is optional for a newly created Individual Challenge. The create action is enabled when the date range, optional-location requirements, and invited participant requirements are valid even when the message body is empty. Empty initial challenge bodies are accepted by `server/lib/inbox-service.js`; replies still require non-empty message text. Blank initial bodies are not rendered as empty message paragraphs in the expanded challenge view.

## Profile first and last name

`src/pages/Profile.tsx` now displays editable First Name and Last Name fields above the read-only email value. The profile API returns `firstName` and `lastName`, validates both on save, combines them into the canonical display name, updates the Better Auth user name, and persists the same display name to `app_users.name`. This keeps subsequent authenticated requests and GolfHomiez participant lookups aligned with the updated profile name.

No database schema change is required because both Better Auth and `app_users` already store the canonical user name. Existing migrations and the `npm install` postinstall migration flow remain unchanged.

## Logging

Profile name validation is logged on the frontend as `profile_invalid_name`. Successful backend auth-name synchronization is logged as `profile_auth_name_updated`. Existing request correlation IDs continue to connect frontend, access, API, and error logs. Names are not included in the newly added log fields; the events record only whether a valid name was present.

## Verification

Regression coverage is in `test/challenge-enhancements.test.js` and `test/app.test.js`. It verifies that a new Individual Challenge can be created with a blank message, replies still require content, name fields render above email, and profile saves synchronize the canonical display name through Better Auth and `app_users`.
