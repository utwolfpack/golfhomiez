# npm audit remediation - 2026-07-28

> **Superseded for routing/ESLint dependency guidance by `NPM-AUDIT-072826-V2.md` after the July 28 follow-up audit.**


## Scope

This remediation addresses the dependency findings in `npmAudit072826.txt`, which reported 14 vulnerabilities: 1 low, 7 moderate, 5 high, and 1 critical. The affected dependency families were `@babel/core`, `better-auth`, `body-parser`, `brace-expansion`, `esbuild`/`vite`, `js-yaml`, `kysely`, `postcss`, `qs`/`express`, `react-router`/`react-router-dom`, and `uuid`.

No database schema changes are required for this work, so no migration was added. No application ports or port configuration were changed.

## Dependency changes

Direct dependencies were moved to patched release lines while avoiding larger upgrades than necessary:

| Dependency | Previous resolved line | Target | Reason |
| --- | --- | --- | --- |
| `better-auth` | 1.5.x | `^1.6.25` | Clears the audit range ending at 1.6.21 and incorporates the current stable 1.6.x security fixes. |
| `express` | 4.22.1 | `^4.22.2` | Keeps Express on v4 while moving beyond the affected 4.22.1 range. |
| `react-router-dom` | 6.30.x | `^7.18.1` | The audit range includes the available 6.30.x line, so a v7 compatibility upgrade is required. |
| `uuid` | 9.x | `^11.1.1` | Uses the first fixed v11 maintenance release rather than jumping to v14. |
| `vite` | 5.4.x | `^6.4.3` | Moves beyond the audit's affected Vite range while avoiding Vite 7/8. |

Root `overrides` enforce patched transitive versions for the vulnerable packages that are not direct dependencies:

- `@babel/core` 7.29.7
- `body-parser` 1.20.6
- `brace-expansion` 1.x -> 1.1.16 and 5.x -> 5.0.8
- `js-yaml` 4.3.0
- `kysely` 0.28.17
- `postcss` 8.5.23
- `qs` 6.15.3

Vite 6.4.3 resolves the vulnerable esbuild path; a separate global `esbuild` override is intentionally not used so Vite can resolve the esbuild version it declares compatible.

## Breaking-change risk assessment

### High security priority / medium application regression risk: Better Auth

The audit contains the critical finding and several high-severity authentication findings. Updating Better Auth is the highest-priority security change. The project imports `betterAuth`, `better-auth/node`, `better-auth/react`, and the Better Auth migration helper, so authentication and migration behavior are the main regression surface.

Test:

- New account registration and verification.
- Existing user login/logout.
- Session persistence, expiration, and rejection of stale/deleted-user sessions.
- Forgot/reset password flows for user, host, organizer, and admin entry points.
- Better Auth database migration/bootstrap against both a clean database and a copy of the current production schema.
- Protected API requests before and after session expiration.
- Any OAuth/OIDC/organization plugin flow if enabled in a deployment.

### Medium-high regression risk: React Router 6 -> 7

This is the largest direct major-version change. React Router v7 retains `react-router-dom` as a compatibility package, and the application currently uses declarative APIs such as `BrowserRouter`, `Routes`, `Route`, `Navigate`, `Link`, `NavLink`, `useNavigate`, `useLocation`, `useParams`, and `useSearchParams`. A test was added to prevent accidental use of React Router APIs removed in v7. React Router v7 also requires Node 20+, so the project engine floor is now Node 20; the Dockerfile already uses Node 20.

Test:

- Direct loading and browser refresh of every protected and public route.
- Browser Back/Forward behavior.
- Login redirect to the intended destination.
- User, host, organizer, and admin protected-route redirects.
- Registration, verification, reset-password, invitation, and tournament URLs that depend on query parameters.
- Tournament portal deep links and challenge/leaderboard navigation.
- Links from Home, Profile, Teams, My Golf Scores, My Tournaments, Inbox, Support, and each role portal.

### Medium regression risk: Vite 5 -> 6

Vite 6 is a major release, but the project uses a small Vite configuration and does not appear to rely on the migration guide's higher-risk low-level runtime APIs. The important validation is build/development behavior rather than business logic.

Test:

- `npm run build` completes with no TypeScript/bundler errors.
- `npm run dev` starts the client/server workflow.
- Hot module reload works during local frontend editing.
- `/api` development proxy calls reach the backend.
- Production static assets load after deployment and a hard browser refresh.
- CSS renders correctly on desktop and mobile.

### Low regression risk: UUID 9 -> 11.1.1

The application uses only `import { v4 as uuidv4 } from 'uuid'`. The added dependency test enforces that assumption. The upgrade avoids the larger v12+ module-format change.

Test UUID-generating flows such as team creation, score creation, invitations, and other operations that create application IDs.

### Low regression risk: Express/body-parser/qs patch updates

Express stays on the v4 line; body-parser and qs remain on their existing major lines. Primary risk is request parsing/error behavior.

Test:

- JSON POST/PATCH endpoints.
- URL/query-string filters used by courses, scores, tournaments, inbox, and administrative screens.
- Invalid JSON and malformed query strings return controlled 4xx responses rather than crashing the process.
- Oversized request bodies are rejected according to configured limits.
- File/logo/image-related requests that pass metadata through JSON bodies.

### Low-to-medium regression risk: transitive build/config/database patches

`@babel/core`, `brace-expansion`, `js-yaml`, `postcss`, and `kysely` remain on compatible release families. Kysely is used through Better Auth and should receive extra attention around authentication database operations.

Test:

- Frontend production build and representative CSS-heavy pages.
- ESLint/config parsing.
- Better Auth database reads/writes and migrations.
- Nodemon/local development startup.

## Application regression checklist

The following areas should be exercised before production deployment because they are either dependency-sensitive or high-value core workflows:

1. Authentication and role isolation: user, host, organizer, admin; registration; verification; login/logout; forgot/reset password; session expiry.
2. Routing/deep links: protected routes, query-parameter routes, invite/reset links, Back/Forward, hard refresh.
3. Golf score logging: solo logger, team logger, save/edit rounds, next-unsaved-hole flow, course/state selection.
4. Teams: create/update teams, invitations, membership checks, duplicate prevention, team dashboards.
5. Tournaments: host/organizer create/edit/publish/register flows, My Tournaments, tournament registration and cancellation states.
6. Tournament Team Score changes: Team Score entry, per-hole saves, leaderboard ranking, live refresh, team round summary, edit-own-team authorization.
7. Challenges/leaderboards: individual and team challenge pages, leaderboard navigation, mobile rendering.
8. Course data APIs: state/course lists, course-hole loading, scorecard geometry/yardage data paths.
9. API robustness: JSON parsing, query strings, validation errors, unauthorized requests, payload-size handling.
10. Frontend/build: Vite dev server, HMR, API proxy, production build, static asset loading, CSS/mobile layouts.
11. Database/migrations: clean install, migration run against a current-schema copy, schema backup/rollback tests.
12. Logging: access/api/frontend logs still receive the same correlation id across representative transactions and errors.

## Automated verification added

`test/dependency-security.test.js` is included in the normal `npm test` command and verifies:

- Direct dependency security floors.
- Transitive security overrides.
- Node 20 minimum.
- Security audit/test npm scripts.
- UUID usage remains limited to the v4 named export.
- Frontend routing remains on the `react-router-dom` v7 compatibility surface and does not import React Router APIs removed in v7.

Commands:

```bash
npm run test:security
npm test
npm run lint
npm run build
npm run security:audit
```

`npm run security:audit` uses `--audit-level=low`, so any low-or-higher audit finding produces a failing exit status.

## Install and deployment sequence

Perform the dependency install first in a development/stage environment using a copy of the current database:

```bash
rm -rf node_modules
npm install
npm run test:security
npm test
npm run lint
npm run build
npm run security:audit
```

The existing `postinstall` still executes project cleanup, database migrations, and the build. Review and commit the regenerated `package-lock.json` after `npm install`, then use that committed lockfile for deterministic production installs.

Do not use the old lockfile as evidence that remediation is complete: it still records the pre-remediation dependency graph until an install can contact the npm registry and regenerate it.

## Validation limitation in this work environment

The source-level security tests pass. A registry-backed install/package-lock regeneration and a post-upgrade `npm audit` could not be completed in the work environment because the configured npm registry timed out and the public npm registry lookup failed with DNS `EAI_AGAIN`. Therefore, the dependency targets and overrides are prepared, but the final deployment gate is to regenerate `package-lock.json` in an environment with registry access and require `npm run security:audit` to pass before production deployment.
