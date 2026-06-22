
> golf-scramble-app@1.0.0 test
> node --test test/app.test.js test/schema-rollback.test.js

TAP version 13
# Golfbert API base URL normalized from web app URL to API host
# Created MySQL pool
# Subtest: email helpers normalize and validate addresses
ok 1 - email helpers normalize and validate addresses
  ---
  duration_ms: 3.0264
  ...
# Subtest: forgot password client points at the correct Better Auth endpoint
ok 2 - forgot password client points at the correct Better Auth endpoint
  ---
  duration_ms: 1.417
  ...
# Subtest: better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally
ok 3 - better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally
  ---
  duration_ms: 0.7428
  ...
# Subtest: API client attaches the user timezone header for server-side date validation
ok 4 - API client attaches the user timezone header for server-side date validation
  ---
  duration_ms: 0.5899
  ...
# Subtest: create-team normalization always makes the signed-in user the first member
ok 5 - create-team normalization always makes the signed-in user the first member
  ---
  duration_ms: 1.8683
  ...
# Subtest: locked lead member falls back to the email local-part when the user name is unavailable
ok 6 - locked lead member falls back to the email local-part when the user name is unavailable
  ---
  duration_ms: 0.1533
  ...
# Subtest: team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers
ok 7 - team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers
  ---
  duration_ms: 0.5722
  ...
# Subtest: team logger has a compact team round header and locked hole-by-hole summary without money fields
ok 8 - team logger has a compact team round header and locked hole-by-hole summary without money fields
  ---
  duration_ms: 0.8572
  ...
# Subtest: date helpers reject future dates in the supplied local timezone
ok 9 - date helpers reject future dates in the supplied local timezone
  ---
  duration_ms: 20.2342
  ...
# Subtest: score logger pages use the user-local date helper for date picker limits
ok 10 - score logger pages use the user-local date helper for date picker limits
  ---
  duration_ms: 1.7067
  ...
# Subtest: solo logger defaults to compact hole-by-hole scorecard entry
ok 11 - solo logger defaults to compact hole-by-hole scorecard entry
  ---
  duration_ms: 2.0187
  ...
# Subtest: hole-by-hole input uses the scoreinput reference layout throughout the app
ok 12 - hole-by-hole input uses the scoreinput reference layout throughout the app
  ---
  duration_ms: 1.4339
  ...
# Subtest: hole-by-hole scorecard uses dedicated hole pages, persisted draft scores, completion indicators, and generated par 72 defaults
ok 13 - hole-by-hole scorecard uses dedicated hole pages, persisted draft scores, completion indicators, and generated par 72 defaults
  ---
  duration_ms: 2.5258
  ...
# Subtest: tee selection is wired through score logging, challenges, storage, migrations, and Golfbert scorecards
ok 14 - tee selection is wired through score logging, challenges, storage, migrations, and Golfbert scorecards
  ---
  duration_ms: 5.8045
  ...
# Subtest: admin portal persists and filters external API call metrics by API type and endpoint
ok 15 - admin portal persists and filters external API call metrics by API type and endpoint
  ---
  duration_ms: 3.2166
  ...
# Subtest: Golfbert client maps courses, holes, and golfer distance without polygon calls
ok 16 - Golfbert client maps courses, holes, and golfer distance without polygon calls
  ---
  duration_ms: 135.556
  ...
# Subtest: Golfbert course search returns all state courses using paged Golfbert marker requests without UI limits
ok 17 - Golfbert course search returns all state courses using paged Golfbert marker requests without UI limits
  ---
  duration_ms: 15.7967
  ...
# Subtest: Golfbert distance helper returns yardage between golfer and flag coordinates
ok 18 - Golfbert distance helper returns yardage between golfer and flag coordinates
  ---
  duration_ms: 1.3436
  ...
# Subtest: finished round hole details use score words and requested scoring backgrounds
ok 19 - finished round hole details use score words and requested scoring backgrounds
  ---
  duration_ms: 1.8826
  ...
# Subtest: round detail modal keeps solo holes single-sided and labels team hole output by team name
ok 20 - round detail modal keeps solo holes single-sided and labels team hole output by team name
  ---
  duration_ms: 1.2054
  ...
# Subtest: round detail modal exposes opponent score links plus edit and delete actions
ok 21 - round detail modal exposes opponent score links plus edit and delete actions
  ---
  duration_ms: 2.863
  ...
# Subtest: scorecard backend endpoint, draft persistence, storage migrations, and transaction logging are wired
ok 22 - scorecard backend endpoint, draft persistence, storage migrations, and transaction logging are wired
  ---
  duration_ms: 4.1506
  ...
# Subtest: scorecard draft helpers normalize context and hole payloads for per-hole persistence
ok 23 - scorecard draft helpers normalize context and hole payloads for per-hole persistence
  ---
  duration_ms: 1.4752
  ...
# Subtest: logged event rows remain clickable buttons for round detail access
ok 24 - logged event rows remain clickable buttons for round detail access
  ---
  duration_ms: 0.8623
  ...
# Subtest: handicap UI is clickable, filter-relative, and shows a breakdown modal
ok 25 - handicap UI is clickable, filter-relative, and shows a breakdown modal
  ---
  duration_ms: 2.3669
  ...
# Subtest: validation warnings stay hidden until save is attempted
ok 26 - validation warnings stay hidden until save is attempted
  ---
  duration_ms: 4.34
  ...
# Subtest: logged round views show incomplete hole-by-hole indicators
ok 27 - logged round views show incomplete hole-by-hole indicators
  ---
  duration_ms: 1.9173
  ...
# Subtest: money tracking UI and active score calculation paths are removed
ok 28 - money tracking UI and active score calculation paths are removed
  ---
  duration_ms: 2.9116
  ...
# Subtest: homepage shows guest sample scores when no user is logged in
ok 29 - homepage shows guest sample scores when no user is logged in
  ---
  duration_ms: 0.8493
  ...
# Subtest: logging writes to root access and error log files with request middleware support
ok 30 - logging writes to root access and error log files with request middleware support
  ---
  duration_ms: 0.8798
  ...
# Subtest: profile page removes state code, uses smiley selection, and redirects home after save
ok 31 - profile page removes state code, uses smiley selection, and redirects home after save
  ---
  duration_ms: 1.1972
  ...
# Subtest: profile server schema and migration remove primary_state_code and reject conflicting preferences
ok 32 - profile server schema and migration remove primary_state_code and reject conflicting preferences
  ---
  duration_ms: 3.0734
  ...
# Subtest: homepage demo seeder can populate the sample rounds locally
ok 33 - homepage demo seeder can populate the sample rounds locally
  ---
  duration_ms: 0.4872
  ...
# Subtest: safe mobile diagnostics use pixel beacons instead of recursive preboot network logging
ok 34 - safe mobile diagnostics use pixel beacons instead of recursive preboot network logging
  ---
  duration_ms: 1.4133
  ...
# Subtest: register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle
ok 35 - register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle
  ---
  duration_ms: 0.2665
  ...
# Subtest: location resources use backend endpoints and keep datasets off the client
ok 36 - location resources use backend endpoints and keep datasets off the client
  ---
  duration_ms: 10.1513
  ...
# Subtest: mobile location lookup runs on the server and keeps browser datasets out of the client
ok 37 - mobile location lookup runs on the server and keeps browser datasets out of the client
  ---
  duration_ms: 2.3662
  ...
# Subtest: profile city typeahead auto-populates state and zip with correlated logging
ok 38 - profile city typeahead auto-populates state and zip with correlated logging
  ---
  duration_ms: 1.9117
  ...
# Subtest: tee selector shows the white-default helper only until a tee is selected
ok 39 - tee selector shows the white-default helper only until a tee is selected
  ---
  duration_ms: 1.3131
  ...
# Subtest: hole tracker always renders eighteen circles and marks saved holes light blue
ok 40 - hole tracker always renders eighteen circles and marks saved holes light blue
  ---
  duration_ms: 1.2497
  ...
# Subtest: solo hole-by-hole controls show date and course above actions without saved holes progress section
ok 41 - solo hole-by-hole controls show date and course above actions without saved holes progress section
  ---
  duration_ms: 0.5699
  ...
# Subtest: solo logged round edit hides the round comparison panel while editing
ok 42 - solo logged round edit hides the round comparison panel while editing
  ---
  duration_ms: 0.5172
  ...
# Subtest: hole-by-hole close actions save the active dirty score before closing edit flows
ok 43 - hole-by-hole close actions save the active dirty score before closing edit flows
  ---
  duration_ms: 1.6928
  ...
# Subtest: solo hole tracker merge keeps unsaved persisted holes marked missing
ok 44 - solo hole tracker merge keeps unsaved persisted holes marked missing
  ---
  duration_ms: 1.2894
  ...
# Subtest: the package test script targets the maintained test suite files
ok 45 - the package test script targets the maintained test suite files
  ---
  duration_ms: 0.342
  ...
# Subtest: auth session lifetime is set to 24 hours and registration signs the user out until verification
ok 46 - auth session lifetime is set to 24 hours and registration signs the user out until verification
  ---
  duration_ms: 0.6088
  ...
# Subtest: legacy users are backfilled as verified while new sign-ins still require verification
ok 47 - legacy users are backfilled as verified while new sign-ins still require verification
  ---
  duration_ms: 1.5055
  ...
# Subtest: smtp logging has a dedicated smtp log with shared correlation ids
ok 48 - smtp logging has a dedicated smtp log with shared correlation ids
  ---
  duration_ms: 0.598
  ...
# Subtest: verification flow prepopulates email and shows registration completion guidance
ok 49 - verification flow prepopulates email and shows registration completion guidance
  ---
  duration_ms: 0.2509
  ...
# Subtest: navigation uses the styled dropdown menu items and moves user resource links to profile
ok 50 - navigation uses the styled dropdown menu items and moves user resource links to profile
  ---
  duration_ms: 0.7189
  ...
# Subtest: teams page supports team creation, invite validation, two-to-five roster sizes, pending status, and compact non-edit display
ok 51 - teams page supports team creation, invite validation, two-to-five roster sizes, pending status, and compact non-edit display
  ---
  duration_ms: 5.0317
  ...
# Subtest: registration routes stay same-origin and client log ingestion supports both legacy and current endpoints
ok 52 - registration routes stay same-origin and client log ingestion supports both legacy and current endpoints
  ---
  duration_ms: 1.0508
  ...
# Subtest: client log ingestion endpoints support singular and plural routes
ok 53 - client log ingestion endpoints support singular and plural routes
  ---
  duration_ms: 6.4705
  ...
# Subtest: auth API defaults to same-origin auth in deployed environments when override origin mismatches
ok 54 - auth API defaults to same-origin auth in deployed environments when override origin mismatches
  ---
  duration_ms: 0.873
  ...
# Subtest: app startup resets session log files so logs only reflect the current session
ok 55 - app startup resets session log files so logs only reflect the current session
  ---
  duration_ms: 0.5223
  ...
# Subtest: profile enrichment runs on first sign-in and adds editable profile fields without profile location prefill
ok 56 - profile enrichment runs on first sign-in and adds editable profile fields without profile location prefill
  ---
  duration_ms: 1.3525
  ...
# Subtest: profile API and migration support one-time enrichment and stored location preferences
ok 57 - profile API and migration support one-time enrichment and stored location preferences
  ---
  duration_ms: 2.2361
  ...
# Subtest: host auth flow keeps request-based host access and removes host invite redemption
ok 58 - host auth flow keeps request-based host access and removes host invite redemption
  ---
  duration_ms: 4.3549
  ...
# Subtest: host auth module exports login helpers required by server startup
ok 59 - host auth module exports login helpers required by server startup
  ---
  duration_ms: 9.2684
  ...
# Subtest: admin portal can approve or delete golf-course account requests and sends host approval email guidance
ok 60 - admin portal can approve or delete golf-course account requests and sends host approval email guidance
  ---
  duration_ms: 3.4969
  ...
# Subtest: admin portal adds compact review dashboard, tournament metadata, account modals, and removes manual host invites
ok 61 - admin portal adds compact review dashboard, tournament metadata, account modals, and removes manual host invites
  ---
  duration_ms: 3.6752
  ...
# Subtest: golfadmin portal deletes admin users without allowing self or last active admin deletion
ok 62 - golfadmin portal deletes admin users without allowing self or last active admin deletion
  ---
  duration_ms: 1.3683
  ...
# Subtest: golfadmin password reset emails reset links and supports username or email lookup
ok 63 - golfadmin password reset emails reset links and supports username or email lookup
  ---
  duration_ms: 1.1751
  ...
# Subtest: mysql score storage remains compatible before and after golf-course score columns exist
ok 64 - mysql score storage remains compatible before and after golf-course score columns exist
  ---
  duration_ms: 2.8995
  ...
# Subtest: auth TTL is 24 hours and refreshed on authenticated activity for user, admin, and host sessions
ok 65 - auth TTL is 24 hours and refreshed on authenticated activity for user, admin, and host sessions
  ---
  duration_ms: 1.7615
  ...
# Subtest: expired authenticated sessions redirect to the correct login page and log frontend event data
ok 66 - expired authenticated sessions redirect to the correct login page and log frontend event data
  ---
  duration_ms: 1.6581
  ...
# Subtest: auth TTL migration and port configuration are deployable without hardcoded server ports
ok 67 - auth TTL migration and port configuration are deployable without hardcoded server ports
  ---
  duration_ms: 1.0428
  ...
# Subtest: host portal exposes tournament creation, portal listing, and organizer invite routes
ok 68 - host portal exposes tournament creation, portal listing, and organizer invite routes
  ---
  duration_ms: 0.6603
  ...
# Subtest: organizer invite flow exposes direct auth, portal, eligibility, and public tournament portal endpoints
ok 69 - organizer invite flow exposes direct auth, portal, eligibility, and public tournament portal endpoints
  ---
  duration_ms: 0.6948
  ...
# Subtest: organizer login exposes password reset and does not expose create organizer access
ok 70 - organizer login exposes password reset and does not expose create organizer access
  ---
  duration_ms: 3.3162
  ...
# Subtest: organizer sessions use the same 24-hour sliding TTL pattern as host sessions
ok 71 - organizer sessions use the same 24-hour sliding TTL pattern as host sessions
  ---
  duration_ms: 0.3835
  ...
# Subtest: organizer portal only edits host-invited tournaments and does not create tournaments
ok 72 - organizer portal only edits host-invited tournaments and does not create tournaments
  ---
  duration_ms: 1.1797
  ...
# Subtest: organizer tournament edit form moves registration deadline below date and hides descriptions outside edit mode
ok 73 - organizer tournament edit form moves registration deadline below date and hides descriptions outside edit mode
  ---
  duration_ms: 0.6786
  ...
# Subtest: host and organizer profile pages can update portal account details with correlated logging
ok 74 - host and organizer profile pages can update portal account details with correlated logging
  ---
  duration_ms: 3.2096
  ...
# Subtest: organizer portal orders tournaments by recent tournament or invite activity
ok 75 - organizer portal orders tournaments by recent tournament or invite activity
  ---
  duration_ms: 0.7651
  ...
# Subtest: tournament portal lookup accepts host-generated public identifiers as well as ids
ok 76 - tournament portal lookup accepts host-generated public identifiers as well as ids
  ---
  duration_ms: 0.4774
  ...
# Subtest: host portal lets hosts modify every golf-course tournament and exposes published registration URLs
ok 77 - host portal lets hosts modify every golf-course tournament and exposes published registration URLs
  ---
  duration_ms: 1.5515
  ...
# Subtest: published tournament registration uses resolved tournament id for foreign key inserts
ok 78 - published tournament registration uses resolved tournament id for foreign key inserts
  ---
  duration_ms: 0.6035
  ...
# Subtest: host and organizer tournament tiles expose registered golfer counts and details
ok 79 - host and organizer tournament tiles expose registered golfer counts and details
  ---
  duration_ms: 1.3494
  ...
# Subtest: tournament registration sends confirmation email with tournament link
ok 80 - tournament registration sends confirmation email with tournament link
  ---
  duration_ms: 0.5671
  ...
# Subtest: signed-in golfers have a registered tournaments page and API route
ok 81 - signed-in golfers have a registered tournaments page and API route
  ---
  duration_ms: 1.4866
  ...
# Subtest: tournament portal marks already registered golfers and replaces register button with a label
ok 82 - tournament portal marks already registered golfers and replaces register button with a label
  ---
  duration_ms: 1.238
  ...
# Subtest: server blocks duplicate tournament registration instead of upserting existing rows
ok 83 - server blocks duplicate tournament registration instead of upserting existing rows
  ---
  duration_ms: 0.989
  ...
# Subtest: tournament registrations migration keeps tournament_id compatible with tournaments id and runs during npm install
ok 84 - tournament registrations migration keeps tournament_id compatible with tournaments id and runs during npm install
  ---
  duration_ms: 1.3834
  ...
# Subtest: tournament registration requires two-person or four-person teams and stores team details
ok 85 - tournament registration requires two-person or four-person teams and stores team details
  ---
  duration_ms: 2.4219
  ...
# Subtest: tournament portal uses per-user registration and host-organizer portals keep team roster status
ok 86 - tournament portal uses per-user registration and host-organizer portals keep team roster status
  ---
  duration_ms: 2.4736
  ...
# Subtest: published status controls public tournament visibility and visibility checkbox is removed
ok 87 - published status controls public tournament visibility and visibility checkbox is removed
  ---
  duration_ms: 1.1639
  ...
# Subtest: front-end tournament times are formatted without milliseconds and profile enrichment clears enrich query parameter
ok 88 - front-end tournament times are formatted without milliseconds and profile enrichment clears enrich query parameter
  ---
  duration_ms: 1.2141
  ...
# Subtest: tournament UI supports a single tournament date and clears end date on updates
ok 89 - tournament UI supports a single tournament date and clears end date on updates
  ---
  duration_ms: 1.7314
  ...
# Subtest: front-end dates use friendly user-local month day year time formatting
ok 90 - front-end dates use friendly user-local month day year time formatting
  ---
  duration_ms: 1.4477
  ...
# Subtest: tournament portal includes a close button back to my tournaments
ok 91 - tournament portal includes a close button back to my tournaments
  ---
  duration_ms: 0.4353
  ...
# Subtest: tournament flyer template is persisted, editable, and supports organizer-provided imagery and fields
ok 92 - tournament flyer template is persisted, editable, and supports organizer-provided imagery and fields
  ---
  duration_ms: 3.7748
  ...
# Subtest: host tournament creation supports stage schemas without host role assignment ids
ok 93 - host tournament creation supports stage schemas without host role assignment ids
  ---
  duration_ms: 0.9975
  ...
# Subtest: host tournament invite supports stage schemas without organizer role assignment ids
ok 94 - host tournament invite supports stage schemas without organizer role assignment ids
  ---
  duration_ms: 0.7405
  ...
# Subtest: organizer registration schema alignment adds account registration columns
ok 95 - organizer registration schema alignment adds account registration columns
  ---
  duration_ms: 1.4051
  ...
# Subtest: organizer session lookup is collation-safe for stage schema differences
ok 96 - organizer session lookup is collation-safe for stage schema differences
  ---
  duration_ms: 1.849
  ...
# Subtest: tournament portal QR code generator returns a scannable SVG-sized matrix and rejects oversized URLs
ok 97 - tournament portal QR code generator returns a scannable SVG-sized matrix and rejects oversized URLs
  ---
  duration_ms: 46.0154
  ...
# Subtest: tournament flyer renders a per-page QR code backed by an API route with shared correlation logging
ok 98 - tournament flyer renders a per-page QR code backed by an API route with shared correlation logging
  ---
  duration_ms: 2.2561
  ...
# Subtest: tournament delete helper removes only safe tournament-owned records inside one transaction
ok 99 - tournament delete helper removes only safe tournament-owned records inside one transaction
  ---
  duration_ms: 1.6215
  ...
# Subtest: manual tournament delete controls are removed and cancelled tournaments are scheduled for safe Sunday cleanup
ok 100 - manual tournament delete controls are removed and cancelled tournaments are scheduled for safe Sunday cleanup
  ---
  duration_ms: 3.4106
  ...
# Subtest: cancelled tournament cleanup job deletes cancelled tournaments and totals safe child records
ok 101 - cancelled tournament cleanup job deletes cancelled tournaments and totals safe child records
  ---
  duration_ms: 0.9874
  ...
# Subtest: cancelled tournament cleanup next run is Sunday at 18:00 America/Denver
ok 102 - cancelled tournament cleanup next run is Sunday at 18:00 America/Denver
  ---
  duration_ms: 2.0924
  ...
# Subtest: uploaded app and tournament banner assets are wired with correlated frontend logging
ok 103 - uploaded app and tournament banner assets are wired with correlated frontend logging
  ---
  duration_ms: 1.6344
  ...
# Subtest: redundant tournament template name migration removes legacy JSON name data
ok 104 - redundant tournament template name migration removes legacy JSON name data
  ---
  duration_ms: 2.934
  ...
# Subtest: tournament locations use resolved physical golf-course addresses and print keeps the banner full width
ok 105 - tournament locations use resolved physical golf-course addresses and print keeps the banner full width
  ---
  duration_ms: 2.0379
  ...
# Subtest: tournament capacity defaults, migration, API stats, and correlated logging are wired
ok 106 - tournament capacity defaults, migration, API stats, and correlated logging are wired
  ---
  duration_ms: 4.8327
  ...
# Subtest: tournament pages collapse mobile content to avoid horizontal scrolling
ok 107 - tournament pages collapse mobile content to avoid horizontal scrolling
  ---
  duration_ms: 1.1371
  ...
# Subtest: host and organizer portal profile pages hide website URLs and submit null notes by default
ok 108 - host and organizer portal profile pages hide website URLs and submit null notes by default
  ---
  duration_ms: 0.4023
  ...
# Subtest: profile update APIs leave website_url untouched and log correlated transactions
ok 109 - profile update APIs leave website_url untouched and log correlated transactions
  ---
  duration_ms: 1.016
  ...
# Subtest: profile notes null-default migration is registered and npm install runs migrations
ok 110 - profile notes null-default migration is registered and npm install runs migrations
  ---
  duration_ms: 1.1722
  ...
# Subtest: admin scheduled jobs page, manual run API, migration, and dedicated logs are wired
ok 111 - admin scheduled jobs page, manual run API, migration, and dedicated logs are wired
  ---
  duration_ms: 3.2258
  ...
# Subtest: host portal starts create tournament panel minimized and orders tournaments by creation date descending
ok 112 - host portal starts create tournament panel minimized and orders tournaments by creation date descending
  ---
  duration_ms: 1.545
  ...
# Subtest: host and organizer profile phone fields validate phone numbers on the frontend and API
ok 113 - host and organizer profile phone fields validate phone numbers on the frontend and API
  ---
  duration_ms: 1.9779
  ...
# Subtest: support page routes support messages for golf users, hosts, and organizers with account-type email subjects, redirects, and logging
ok 114 - support page routes support messages for golf users, hosts, and organizers with account-type email subjects, redirects, and logging
  ---
  duration_ms: 2.6069
  ...
# Subtest: golf user inbox supports messages, Team Challenges, unread indicators, invite fallback, migrations, and logging
ok 115 - golf user inbox supports messages, Team Challenges, unread indicators, invite fallback, migrations, and logging
  ---
  duration_ms: 12.4152
  ...
# Subtest: home and my golf scores use Team Challenges from inbox score records instead of Team Logger records for score filters
ok 116 - home and my golf scores use Team Challenges from inbox score records instead of Team Logger records for score filters
  ---
  duration_ms: 3.0562
  ...
# Subtest: golf course datasource has shifted from local database/CSV to Golfbert API
ok 117 - golf course datasource has shifted from local database/CSV to Golfbert API
  ---
  duration_ms: 4.2145
  ...
# Subtest: registration defers location collection to first profile sign-in setup with correlated logging
ok 118 - registration defers location collection to first profile sign-in setup with correlated logging
  ---
  duration_ms: 2.152
  ...
# Subtest: challenge thread renders the challenge type only once in the card header
ok 119 - challenge thread renders the challenge type only once in the card header
  ---
  duration_ms: 0.7197
  ...
