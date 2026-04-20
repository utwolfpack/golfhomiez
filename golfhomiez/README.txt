This patch updates only test/app.test.js.

It fixes the two failing tests shown in the uploaded failure log by allowing the
current helper-based implementation in src/lib/locations.ts:

- direct fetch(...)
- helper-based fetchJson(...)

Apply the diff in test/app.test.js, then run:

npm test
