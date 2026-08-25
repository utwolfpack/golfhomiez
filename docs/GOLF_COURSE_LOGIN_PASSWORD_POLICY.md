# Golf Course Login and Password Policy

## User-interface changes

- `/host/login`
  - Uses **golf course** terminology in the visible login experience.
  - Adds a white **Create Golf Course Account** button beside **Golf course login**.
  - The account button opens `/host/register`.
- `/host/request-password-reset`
  - Uses **golf course** terminology in the visible password-reset request experience.
- `/host/reset-password`
  - Uses golf-course terminology and the shared password criteria.

## Password policy

New passwords for GolfHomiez users, golf-course accounts, organizer accounts, and admin accounts must:

- contain at least 10 characters;
- contain at least one uppercase letter;
- contain at least one lowercase letter; and
- contain at least one number.

Special characters are allowed but are not required.

The browser validates and displays the criteria for all account creation/reset flows. The server independently validates the same policy so bypassing the browser cannot create a weak password.

Server enforcement is implemented in `server/lib/password-policy.js` and applied to Better Auth user registration/password changes, golf-course account requests/additional accounts/resets, organizer registration/resets, and admin creation/resets.

Frontend enforcement is implemented in `src/lib/password-policy.ts` with the reusable criteria display in `src/components/PasswordCriteria.tsx`.

## Logging and correlation IDs

Password-policy rejections are logged without recording the password itself. Standard API routes log `password_policy_rejected` with the account type, action, failed criteria, and request correlation context. Better Auth logs `auth_password_policy_rejected` using the incoming `X-Correlation-Id`.

The golf-course login and reset request/reset pages emit frontend lifecycle events. Existing request metadata propagates the same correlation ID to backend requests so access, API, error, and frontend logs can be correlated.

## Database and deployment

No database schema changes are required for this change, so there is no new migration script. Existing migrations and the existing `npm install` postinstall migration flow remain unchanged.

No npm dependency was added for this implementation.
