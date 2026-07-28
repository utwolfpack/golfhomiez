# npm audit follow-up remediation — 2026-07-28 v2

## Audit input

The follow-up `npmAudit072826.v2.txt` report contains **7 high-severity vulnerabilities** in two dependency paths:

- `brace-expansion <=5.0.7`, reached through `minimatch` and ESLint's dependency graph.
- `react-router 7.12.0 - 8.2.0`, reached through `react-router-dom`.

The npm-generated force-fix suggestions would move ESLint to v10 and downgrade `react-router-dom` to 7.11.0. The Router downgrade is intentionally **not** used because the preceding remediation had already moved to the v7.18 line to address earlier React Router advisories. The application is instead moved forward to the patched React Router v8 line.

## Remediation decisions

| Area | Previous remediation | v2 remediation | Breaking-change risk |
| --- | --- | --- | --- |
| React Router | `react-router-dom ^7.18.1` | `react-router ^8.3.0` | **High** |
| React | `react/react-dom ^18.3.1` | `^19.2.8` | **High** |
| Node runtime | `>=20.0.0` | `>=22.22.0` | **High deployment risk** |
| Docker runtime | Node 20 | Node 22 | **Medium-High** |
| ESLint | `^9.9.0` | `^10.8.0` | **Medium; development/CI only** |
| `@eslint/js` | `^9.9.0` | `^10.0.1` | **Medium; development/CI only** |
| React Hooks lint plugin | `^5.1.0` | `^7.1.1` | **Low-Medium; lint only** |
| React Refresh lint plugin | `^0.4.12` | `^0.5.3` | **Low; lint only** |
| Vite | `^6.4.3` | unchanged | **No additional v2 risk** |
| `@vitejs/plugin-react` | `^4.3.1` | unchanged | **No additional v2 risk** |

### Why Vite remains on v6

GolfHomiez uses React Router's **Declarative Mode** (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, and hooks), not React Router Framework Mode or RSC APIs. React Router's v8 upgrade guidance requires Node 22.22+ and React 19.2.7+ for all modes, while the Vite 7 requirement applies to Framework Mode. Keeping the already-patched Vite 6.4.3 line avoids an unrelated bundler major upgrade and reduces regression exposure.

### React Router import migration

React Router v8 removes the `react-router-dom` compatibility package. All application imports were changed from `react-router-dom` to `react-router`. No Data Router, Framework Mode, SSR Router, or RSC APIs were introduced.

The security regression test scans the entire `src` tree to ensure:

- no `react-router-dom` imports remain;
- router imports remain on the Declarative Mode API surface;
- `BrowserRouter` is sourced from `react-router`;
- APIs associated with Data/Framework/RSC modes are not introduced accidentally.

### ESLint 10 migration

The ESLint dependency path is moved to ESLint 10 rather than forcing a cross-major `brace-expansion` override. The lint configuration remains flat-config based. To limit behavior changes, the existing hooks policy is preserved explicitly:

- `react-hooks/rules-of-hooks`: error
- `react-hooks/exhaustive-deps`: warning

The current React Refresh plugin's supported Vite flat configuration is used. This avoids enabling the much larger modern React Hooks recommended rule set as an unintended side effect of the security upgrade.

## Overall breaking-change assessment

**Overall risk: HIGH until stage validation is complete.**

The primary risk is not the vulnerable RSC functionality itself—GolfHomiez does not use RSC mode—but the supported-path upgrade needed to leave the vulnerable React Router version range. That requires a coordinated React Router 8 + React 19 + Node 22.22+ runtime change. The route source conversion is mechanically small, but routing, React rendering semantics, and the server runtime affect broad portions of the application.

ESLint 10 is a lower production risk because it is a development/CI dependency. It can still block deployment if lint is part of CI, so it must be validated before release.

## Required regression test areas

### 1. Authentication and session lifecycle — Critical

Test separately for Golf User, Host, Organizer, and Admin roles:

- registration;
- email verification;
- login and logout;
- 24-hour session persistence;
- expired/invalid session redirects;
- forgot-password and reset-password links;
- host and organizer invite redemption;
- direct navigation to a protected URL while signed out;
- role isolation (a session for one portal must not grant another portal's access).

Why: React 19/Router 8 changes sit around the entire client navigation lifecycle, and Node 22 changes the backend runtime supporting Better Auth.

### 2. Client routing and navigation — Critical

Exercise every major route from both in-app navigation and a browser hard refresh:

- `/`
- `/login`, `/register`, verification/reset flows
- My Golf Scores
- Teams
- Challenges / Inbox
- My Tournaments
- Profile / Support
- `/golfadmin` and admin sub-pages
- Host login/profile/portal
- Organizer login/profile/tournaments
- public tournament pages and invite URLs

For each, test:

- browser refresh on the route;
- Back/Forward navigation;
- links and NavLinks;
- query-string flows (`useSearchParams`);
- dynamic route parameters;
- redirects via `Navigate`/`useNavigate`;
- mobile Safari/Chrome navigation.

### 3. Tournament team scoring — Critical

Test the recently added tournament scoring flow end to end:

- Registered -> Team Score;
- course/tee/hole scorecard loading;
- save each hole and resume persisted scores;
- reset a hole;
- Save Team Score;
- Leaderboard refresh and stack ranking;
- click a team row for round summary;
- edit only the signed-in user's own registered team;
- completed/cancelled tournament read-only behavior;
- correlated frontend/API/access logging for the entire transaction.

### 4. Solo and Team Challenge golf scoring — Critical

- Solo Logger load/save/edit/delete;
- next-unsaved-hole navigation;
- state/course/tee selection;
- 9/18-hole behavior as applicable;
- Team Challenge score entry;
- skins / skins-push calculations;
- partial saves, resets, close/reopen;
- challenge leaderboard refresh;
- finished round detail and comparison views.

### 5. Teams, challenges, invites, and inbox — High

- create/edit/delete teams;
- 2–4 member limits and duplicate prevention;
- member invite/search flow;
- Team Challenge creation/accept/reject;
- inbox unread/read behavior;
- challenge deletion visibility per user;
- direct links opened from email/inbox messages.

### 6. Role portals and tournament administration — High

- Admin host approval/invitation flows;
- Host tournament create/edit/publish/cancel;
- Organizer invitation and permissions;
- tournament registration;
- registrant lists;
- public/private tournament visibility;
- flyer and print views;
- role logout redirects.

### 7. React 19 behavior — High

Focus on components with effects, refs, async state, modals, and rapid navigation:

- open/close/reopen modals repeatedly;
- score entry followed by immediate navigation;
- async API responses arriving after route changes;
- form submissions and double-click prevention;
- lazy-loaded Register page;
- profile/location controls;
- mobile menu and responsive leaderboard controls.

Static regression guards verify no `ReactDOM.render`, `findDOMNode`, or zero-argument `useRef()` usages remain, but runtime behavior still needs browser testing.

### 8. Node 22.22+ server runtime — Critical for deployment

On stage using the same process manager topology as production:

- verify `node --version` is at least 22.22.0;
- start/restart through PM2;
- verify Better Auth startup/session behavior;
- MySQL connectivity (`mysql2`);
- SMTP/Brevo email flows;
- OpenGolfAPI/database course endpoints;
- scheduled jobs;
- graceful restart and log creation;
- Nginx reverse proxy and static application serving.

### 9. Build and developer tooling — High before merge

Using a clean dependency install:

- `npm run test:security`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run security:audit`
- `npm run dev` and Vite HMR

Confirm the production build works in current supported desktop browsers and iPhone Safari. Vite stays on 6.4.3 specifically to avoid introducing a second bundler major upgrade in this security change.

### 10. Logging/correlation — High diagnostic value

For at least one login, score-save, tournament-score, and failure transaction:

- capture the correlation ID;
- locate it in `access.log`;
- locate the same ID in `api.log`/error logging as applicable;
- locate it in `frontend.log` for the client transaction;
- verify dates/messages remain human-readable and no secrets/session tokens are logged.

### 11. Install/migrations — High deployment safeguard

There is **no database schema change in this remediation**, therefore no new migration script is required. Existing behavior still runs migrations from `postinstall`, so test a clean install against a stage database before production deployment and verify previously applied migrations remain idempotent.

## Automated regression guards added/updated

`test/dependency-security.test.js` now verifies:

1. patched direct dependency major lines and Node engine floor;
2. removal of the risky `brace-expansion` cross-major override workaround;
3. preservation of previously required transitive security overrides;
4. security test/audit npm scripts remain wired;
5. Docker/Node runtime baseline;
6. UUID v4 import compatibility remains unchanged;
7. React Router v8 import conversion across all frontend TypeScript files;
8. continued use of Declarative Mode rather than RSC/Data/Framework APIs;
9. React 19 removed-API/static ref guards;
10. ESLint 10 flat config and explicit legacy-equivalent Hooks lint policy.

These guards are included in the normal `npm test` command.

## Validation performed in this work environment

- `npm test`: **163 passed, 0 failed** when run against the uploaded project's existing installed dependency tree. This verifies the application source/static regression suite after the source edits.
- The new dependency-security tests all pass.
- A production Vite build could not be completed in this sandbox because the uploaded `node_modules` tree is Windows-oriented and is missing the Linux Rollup optional native package `@rollup/rollup-linux-x64-gnu`.
- A TypeScript check against the old installed dependency tree is not a valid Router v8 compatibility check because that tree contains React Router 6; it consequently reports that the new v8 `react-router` DOM exports do not exist. It also reports pre-existing application typing issues unrelated to this audit change.
- A clean install of the upgraded packages and a post-upgrade `npm audit` could not be performed here because the execution sandbox cannot access the npm registry.

Therefore, **do not treat this work environment as proof that the new installed dependency graph is audit-clean**. The package ranges are selected to move outside the reported vulnerable ranges, but the regenerated lockfile and audit must be verified in a networked stage/development environment.

## Required install/deploy sequence

1. Upgrade the stage Node runtime to **22.22.0 or newer** and verify with `node --version`.
2. Apply these changed files.
3. Remove the old local dependency tree: `rm -rf node_modules`.
4. Run `npm install --ignore-scripts` to resolve the new graph and regenerate `package-lock.json` without prematurely running migrations/build.
5. Run `npm run test:security`.
6. Run `npm test`.
7. Run `npm run lint`.
8. Run `npm run build`.
9. Run `npm run security:audit`; resolve any remaining low-or-higher finding before production.
10. Run `npm run db:migrate` against stage and smoke test the application.
11. Commit the regenerated `package-lock.json` after successful verification.
12. Deploy the verified commit. Normal `npm ci`/`npm install` behavior can then execute the existing `postinstall` migration/build process.

Do not deploy using the prior lockfile: it describes the pre-v2 dependency graph and cannot establish that the follow-up findings are resolved.

## Changed application paths in this v2 patch

Core configuration/runtime:

- `Dockerfile`
- `package.json`
- `eslint.config.js`
- `test/dependency-security.test.js`
- `docs/NPM-AUDIT-072826.md` (superseded notice)
- `docs/NPM-AUDIT-072826-V2.md`

React Router v8 import migration:

- `src/App.tsx`
- `src/main.tsx`
- `src/components/HostProtectedRoute.tsx`
- `src/components/NavBar.tsx`
- `src/components/OrganizerProtectedRoute.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/pages/AdminPortal.tsx`
- `src/pages/AdminResetPassword.tsx`
- `src/pages/AdminScheduledJobs.tsx`
- `src/pages/Challenges.tsx`
- `src/pages/CreateHostAccount.tsx`
- `src/pages/CreateOrganizerAccount.tsx`
- `src/pages/ForgotPassword.tsx`
- `src/pages/GolfLogger.tsx`
- `src/pages/Home.tsx`
- `src/pages/HostForgotPassword.tsx`
- `src/pages/HostLogin.tsx`
- `src/pages/HostPortal.tsx`
- `src/pages/HostProfile.tsx`
- `src/pages/HostResetPassword.tsx`
- `src/pages/Inbox.tsx`
- `src/pages/InviteHomie.tsx`
- `src/pages/Login.tsx`
- `src/pages/MyGolfScores.tsx`
- `src/pages/MyTournaments.tsx`
- `src/pages/OrganizerForgotPassword.tsx`
- `src/pages/OrganizerLogin.tsx`
- `src/pages/OrganizerProfile.tsx`
- `src/pages/OrganizerRegister.tsx`
- `src/pages/OrganizerResetPassword.tsx`
- `src/pages/OrganizerTournaments.tsx`
- `src/pages/Profile.tsx`
- `src/pages/RedeemHostInvite.tsx`
- `src/pages/Register.tsx`
- `src/pages/ResetPassword.tsx`
- `src/pages/SoloLogger.tsx`
- `src/pages/Support.tsx`
- `src/pages/Teams.tsx`
- `src/pages/TournamentPortal.tsx`
- `src/pages/VerifyContact.tsx`

No port configuration was changed. No database schema was changed.
