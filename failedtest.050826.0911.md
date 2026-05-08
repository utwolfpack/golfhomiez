
> golf-scramble-app@1.0.0 test
> node --test test/app.test.js test/schema-rollback.test.js

TAP version 13
# Subtest: email helpers normalize and validate addresses
ok 1 - email helpers normalize and validate addresses
  ---
  duration_ms: 2.9703
  ...
# Subtest: forgot password client points at the correct Better Auth endpoint
ok 2 - forgot password client points at the correct Better Auth endpoint
  ---
  duration_ms: 0.846
  ...
# Subtest: better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally
ok 3 - better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally
  ---
  duration_ms: 0.3651
  ...
# Subtest: API client attaches the user timezone header for server-side date validation
ok 4 - API client attaches the user timezone header for server-side date validation
  ---
  duration_ms: 0.3089
  ...
# Subtest: create-team normalization always makes the signed-in user the first member
ok 5 - create-team normalization always makes the signed-in user the first member
  ---
  duration_ms: 1.5364
  ...
# Subtest: locked lead member falls back to the email local-part when the user name is unavailable
ok 6 - locked lead member falls back to the email local-part when the user name is unavailable
  ---
  duration_ms: 0.1505
  ...
# Subtest: team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers
ok 7 - team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers
  ---
  duration_ms: 0.4197
  ...
# Subtest: date helpers reject future dates in the supplied local timezone
ok 8 - date helpers reject future dates in the supplied local timezone
  ---
  duration_ms: 17.5867
  ...
# Subtest: score logger pages use the user-local date helper for date picker limits
ok 9 - score logger pages use the user-local date helper for date picker limits
  ---
  duration_ms: 0.7404
  ...
# Subtest: solo logger supports optional 18-hole entry like the team logger
ok 10 - solo logger supports optional 18-hole entry like the team logger
  ---
  duration_ms: 0.5075
  ...
# Subtest: logged event rows remain clickable buttons for round detail access
ok 11 - logged event rows remain clickable buttons for round detail access
  ---
  duration_ms: 0.6796
  ...
# Subtest: handicap UI is clickable, filter-relative, and shows a breakdown modal
ok 12 - handicap UI is clickable, filter-relative, and shows a breakdown modal
  ---
  duration_ms: 1.2179
  ...
# Subtest: validation warnings stay hidden until save is attempted
ok 13 - validation warnings stay hidden until save is attempted
  ---
  duration_ms: 0.727
  ...
# Subtest: homepage shows guest sample scores when no user is logged in
ok 14 - homepage shows guest sample scores when no user is logged in
  ---
  duration_ms: 0.4967
  ...
# Subtest: logging writes to root access and error log files with request middleware support
ok 15 - logging writes to root access and error log files with request middleware support
  ---
  duration_ms: 0.7883
  ...
# Subtest: profile page removes state code, uses smiley selection, and redirects home after save
ok 16 - profile page removes state code, uses smiley selection, and redirects home after save
  ---
  duration_ms: 0.7731
  ...
# Subtest: profile server schema and migration remove primary_state_code and reject conflicting preferences
ok 17 - profile server schema and migration remove primary_state_code and reject conflicting preferences
  ---
  duration_ms: 1.1308
  ...
# Subtest: homepage demo seeder can populate the sample rounds locally
ok 18 - homepage demo seeder can populate the sample rounds locally
  ---
  duration_ms: 0.549
  ...
# Subtest: safe mobile diagnostics use pixel beacons instead of recursive preboot network logging
ok 19 - safe mobile diagnostics use pixel beacons instead of recursive preboot network logging
  ---
  duration_ms: 1.1608
  ...
# Subtest: register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle
ok 20 - register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle
  ---
  duration_ms: 0.5065
  ...
# Subtest: location resources use backend endpoints and keep datasets off the client
ok 21 - location resources use backend endpoints and keep datasets off the client
  ---
  duration_ms: 20.6011
  ...
# Subtest: mobile location lookup runs on the server and keeps browser datasets out of the client
ok 22 - mobile location lookup runs on the server and keeps browser datasets out of the client
  ---
  duration_ms: 1.3792
  ...
# Subtest: the package test script targets the maintained test suite files
ok 23 - the package test script targets the maintained test suite files
  ---
  duration_ms: 0.5731
  ...
# Subtest: auth session lifetime is set to 24 hours and registration signs the user out until verification
ok 24 - auth session lifetime is set to 24 hours and registration signs the user out until verification
  ---
  duration_ms: 0.7314
  ...
# Subtest: legacy users are backfilled as verified while new sign-ins still require verification
ok 25 - legacy users are backfilled as verified while new sign-ins still require verification
  ---
  duration_ms: 0.8033
  ...
# Subtest: smtp logging has a dedicated smtp log with shared correlation ids
ok 26 - smtp logging has a dedicated smtp log with shared correlation ids
  ---
  duration_ms: 0.7225
  ...
# Subtest: verification flow prepopulates email and shows registration completion guidance
ok 27 - verification flow prepopulates email and shows registration completion guidance
  ---
  duration_ms: 0.2373
  ...
# Subtest: navigation uses the styled dropdown menu items and keeps invite access available
ok 28 - navigation uses the styled dropdown menu items and keeps invite access available
  ---
  duration_ms: 0.376
  ...
# Subtest: teams page shows pending verification states, registration invites, and restored edit capability
ok 29 - teams page shows pending verification states, registration invites, and restored edit capability
  ---
  duration_ms: 0.2775
  ...
# Subtest: registration routes stay same-origin and client log ingestion supports both legacy and current endpoints
ok 30 - registration routes stay same-origin and client log ingestion supports both legacy and current endpoints
  ---
  duration_ms: 1.6597
  ...
# Subtest: client log ingestion endpoints support singular and plural routes
ok 31 - client log ingestion endpoints support singular and plural routes
  ---
  duration_ms: 4.0481
  ...
# Subtest: auth API defaults to same-origin auth in deployed environments when override origin mismatches
ok 32 - auth API defaults to same-origin auth in deployed environments when override origin mismatches
  ---
  duration_ms: 0.5986
  ...
# Subtest: app startup resets session log files so logs only reflect the current session
ok 33 - app startup resets session log files so logs only reflect the current session
  ---
  duration_ms: 0.7624
  ...
# Subtest: profile enrichment runs on first sign-in and adds editable profile fields with location prefill
ok 34 - profile enrichment runs on first sign-in and adds editable profile fields with location prefill
  ---
  duration_ms: 0.7498
  ...
# Subtest: profile API and migration support one-time enrichment and stored location preferences
ok 35 - profile API and migration support one-time enrichment and stored location preferences
  ---
  duration_ms: 1.0365
  ...
# Subtest: host auth flow adds direct host routes, public account requests, invite redemption, and reset endpoints
ok 36 - host auth flow adds direct host routes, public account requests, invite redemption, and reset endpoints
  ---
  duration_ms: 1.7408
  ...
# Subtest: admin portal can approve or delete golf-course account requests and sends host approval email guidance
ok 37 - admin portal can approve or delete golf-course account requests and sends host approval email guidance
  ---
  duration_ms: 1.4659
  ...
# Subtest: mysql score storage remains compatible before and after golf-course score columns exist
ok 38 - mysql score storage remains compatible before and after golf-course score columns exist
  ---
  duration_ms: 3.4963
  ...
# Subtest: auth TTL is 24 hours and refreshed on authenticated activity for user, admin, and host sessions
ok 39 - auth TTL is 24 hours and refreshed on authenticated activity for user, admin, and host sessions
  ---
  duration_ms: 1.3504
  ...
# Subtest: expired authenticated sessions redirect to the correct login page and log frontend event data
ok 40 - expired authenticated sessions redirect to the correct login page and log frontend event data
  ---
  duration_ms: 0.7166
  ...
# Subtest: auth TTL migration and port configuration are deployable without hardcoded server ports
ok 41 - auth TTL migration and port configuration are deployable without hardcoded server ports
  ---
  duration_ms: 0.6784
  ...
# Subtest: host portal exposes tournament creation, portal listing, and organizer invite routes
ok 42 - host portal exposes tournament creation, portal listing, and organizer invite routes
  ---
  duration_ms: 0.4209
  ...
# Subtest: organizer invite flow exposes direct auth, portal, eligibility, and public tournament portal endpoints
ok 43 - organizer invite flow exposes direct auth, portal, eligibility, and public tournament portal endpoints
  ---
  duration_ms: 0.5421
  ...
# Subtest: organizer sessions use the same 24-hour sliding TTL pattern as host sessions
ok 44 - organizer sessions use the same 24-hour sliding TTL pattern as host sessions
  ---
  duration_ms: 0.3884
  ...
# Subtest: organizer portal only edits host-invited tournaments and does not create tournaments
ok 45 - organizer portal only edits host-invited tournaments and does not create tournaments
  ---
  duration_ms: 0.9444
  ...
# Subtest: tournament portal lookup accepts host-generated public identifiers as well as ids
ok 46 - tournament portal lookup accepts host-generated public identifiers as well as ids
  ---
  duration_ms: 0.6591
  ...
# Subtest: host portal lets hosts modify every golf-course tournament and exposes published registration URLs
ok 47 - host portal lets hosts modify every golf-course tournament and exposes published registration URLs
  ---
  duration_ms: 1.057
  ...
# Subtest: published tournament registration uses resolved tournament id for foreign key inserts
ok 48 - published tournament registration uses resolved tournament id for foreign key inserts
  ---
  duration_ms: 0.363
  ...
# Subtest: host and organizer tournament tiles expose registered golfer counts and details
ok 49 - host and organizer tournament tiles expose registered golfer counts and details
  ---
  duration_ms: 0.9384
  ...
# Subtest: tournament registration sends confirmation email with tournament link
ok 50 - tournament registration sends confirmation email with tournament link
  ---
  duration_ms: 0.9784
  ...
# Subtest: signed-in golfers have a registered tournaments page and API route
ok 51 - signed-in golfers have a registered tournaments page and API route
  ---
  duration_ms: 0.9248
  ...
# Subtest: tournament portal marks already registered golfers and replaces register button with a label
ok 52 - tournament portal marks already registered golfers and replaces register button with a label
  ---
  duration_ms: 0.5282
  ...
# Subtest: server blocks duplicate tournament registration instead of upserting existing rows
ok 53 - server blocks duplicate tournament registration instead of upserting existing rows
  ---
  duration_ms: 0.6104
  ...
# Subtest: tournament registrations migration keeps tournament_id compatible with tournaments id and runs during npm install
ok 54 - tournament registrations migration keeps tournament_id compatible with tournaments id and runs during npm install
  ---
  duration_ms: 0.8116
  ...
# Subtest: tournament registration requires two-person or four-person teams and stores team details
ok 55 - tournament registration requires two-person or four-person teams and stores team details
  ---
  duration_ms: 1.4486
  ...
# Subtest: published status controls public tournament visibility and visibility checkbox is removed
ok 56 - published status controls public tournament visibility and visibility checkbox is removed
  ---
  duration_ms: 0.8112
  ...
# Subtest: front-end tournament times are formatted without milliseconds and profile enrichment clears enrich query parameter
ok 57 - front-end tournament times are formatted without milliseconds and profile enrichment clears enrich query parameter
  ---
  duration_ms: 0.5928
  ...
# Subtest: tournament UI supports a single tournament date and clears end date on updates
ok 58 - tournament UI supports a single tournament date and clears end date on updates
  ---
  duration_ms: 1.0354
  ...
# Subtest: front-end dates use friendly user-local month day year time formatting
ok 59 - front-end dates use friendly user-local month day year time formatting
  ---
  duration_ms: 0.7745
  ...
# Subtest: tournament portal includes a close button back to my tournaments
ok 60 - tournament portal includes a close button back to my tournaments
  ---
  duration_ms: 0.2841
  ...
# Subtest: tournament flyer template is persisted, editable, and supports organizer-provided imagery and fields
ok 61 - tournament flyer template is persisted, editable, and supports organizer-provided imagery and fields
  ---
  duration_ms: 2.1937
  ...
# Subtest: host tournament creation supports stage schemas without host role assignment ids
ok 62 - host tournament creation supports stage schemas without host role assignment ids
  ---
  duration_ms: 0.6531
  ...
# Subtest: host tournament invite supports stage schemas without organizer role assignment ids
ok 63 - host tournament invite supports stage schemas without organizer role assignment ids
  ---
  duration_ms: 0.621
  ...
# Subtest: organizer registration schema alignment adds account registration columns
ok 64 - organizer registration schema alignment adds account registration columns
  ---
  duration_ms: 0.953
  ...
# Subtest: organizer session lookup is collation-safe for stage schema differences
not ok 65 - organizer session lookup is collation-safe for stage schema differences
  ---
  duration_ms: 2.9316
  location: 'file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:930:1'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /ALTER TABLE organizer_role_accounts MODIFY id VARCHAR\(64\) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL/. Input:
    
    '-- Runtime organizer session queries now use explicit COLLATE clauses, so this\n' +
      '-- migration is intentionally non-destructive. It records the deployment without\n' +
      '-- modifying foreign-keyed organizer account/session columns.\n' +
      'SELECT 1;\n'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: |-
    -- Runtime organizer session queries now use explicit COLLATE clauses, so this
    -- migration is intentionally non-destructive. It records the deployment without
    -- modifying foreign-keyed organizer account/session columns.
    SELECT 1;
    
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:950:10)
    Test.runInAsyncScope (node:async_hooks:206:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
# Subtest: one-time schema rollback is wired into postinstall and removes itself afterward
ok 66 - one-time schema rollback is wired into postinstall and removes itself afterward
  ---
  duration_ms: 2.3138
  ...
# Subtest: rollback migration removes chat-added schema tables and migration records
ok 67 - rollback migration removes chat-added schema tables and migration records
  ---
  duration_ms: 1.4496
  ...
1..67
# tests 67
# suites 0
# pass 66
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 250.2856
