GolfHomiez iGolf Connect change set

Apply this zip from the application root. It contains only files changed for the iGolf Connect datasource implementation.

Deleted files are listed in REMOVED_GOLFBERT_API_FILES.txt. Delete those paths from the target application after extracting this zip.

No database schema change was required for this implementation, so no new migration script is included. The existing package.json postinstall remains the migration/build hook.

Validation performed in the sandbox:
- npm test: 134 passed, 0 failed
- node node_modules/typescript/bin/tsc --noEmit: new iGolf files are clean, but the project still reports pre-existing unrelated TypeScript issues in LocationInput/UseMyLocationButton, RoundDetailModal/Home/MyGolfScores roundInsights declarations, and HostPortal tournament typing.
- npm run build could not be completed against the uploaded node_modules because the uploaded dependency tree is Windows-oriented: node_modules/.bin/vite was not executable and @rollup/rollup-linux-x64-gnu was missing. Run npm install in the target Linux environment before npm run build.
