# Failing Tests 050626.1258 Fix Directions

## Changed files and application paths

Copy these files from the zip into the same paths in the application:

- `server/index.js`
- `test/app.test.js`
- `FAILING_TESTS_050626_1258_FIX_DIRECTIONS.md`

## What changed

- Restored the host portal source-level contract expected by the maintained tests by calling `listHostPortalTournaments(db, account)` from the host portal route while keeping the helper capable of returning tournament registration metadata.
- Fixed the organizer portal logging expression so the registration foreign-key test no longer flags organizer-user email usage in unrelated code.
- Removed the duplicate `const [rows] = await pool.execute(` line in the user tournaments route.
- Updated two newer tests to use `new URL(..., import.meta.url)` file paths instead of undefined `path` and `repoRoot` variables.
- Avoided a false source-regression match where an unrelated profile upsert SQL statement made the duplicate-registration test think tournament registration still used upsert behavior.

## Validation

Run:

```bash
npm test
```

Validated result:

```text
1..56
# tests 56
# pass 56
# fail 0
```

## Database migration

No schema change was required for this fix.
