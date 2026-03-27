This patch adds deeper diagnostics for iPhone page-load failures.

Changed files:
- index.html
- server/index.js
- server/lib/logger.js
- src/App.tsx
- src/context/AuthContext.tsx
- src/lib/api.ts
- src/lib/auth-api.ts
- src/lib/frontend-logger.ts
- src/main.tsx
- test/app.test.js

What was added:
- Separate backend log files for access, api, frontend, and error events.
- Correlation IDs via X-Correlation-Id so one browser session can be traced across frontend, API, and access logs.
- Client log ingestion endpoint at /api/client-logs.
- Early boot logging in index.html to capture failures before React mounts.
- Browser diagnostics for iPhone troubleshooting: user agent, viewport, online status, cookies, touch points, language, screen size, document ready state, navigation timing, load completion, JS errors, and unhandled promise rejections.
- Request logging for frontend API/auth calls, including duration and status.
- Route change and auth session lifecycle diagnostics.

How to deploy:
1. Copy the changed files into the matching paths in the app.
2. Rebuild the frontend:
   npm run build
3. Restart the application.

How to use the logs:
- logging/access.log: request/response lifecycle for HTTP traffic.
- logging/api.log: backend API and app-level operational events.
- logging/frontend.log: browser diagnostics received from the client.
- logging/error.log: backend exceptions.

Recommended workflow for an iPhone failure:
1. Reproduce the issue on the iPhone.
2. Find the correlationId in logging/frontend.log for events such as:
   - html_bootstrap_started
   - react_render_starting
   - window_error_before_app
   - boot_unhandled_rejection
   - auth_get_session / auth_get_session_failed
   - api_request_failed
3. Search that same correlationId in logging/api.log and logging/access.log.
4. Compare whether the failure happened:
   - before React mounted,
   - during auth/session fetch,
   - during a blocked API call,
   - or after load during route navigation.

Database migrations:
- No schema change was required for this logging patch.
