
> golf-scramble-app@1.0.0 test
> node --test test/app.test.js test/schema-rollback.test.js

TAP version 13
# file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:451
#   assert.match(hostRegister, /<label className=\\"label\\">Golf Course<\\\\/label>/)
#                              ^
# SyntaxError: Invalid regular expression flags
#     at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:167:18)
#     at callTranslator (node:internal/modules/esm/loader:285:14)
#     at ModuleLoader.moduleProvider (node:internal/modules/esm/loader:291:30)
#     at async link (node:internal/modules/esm/module_job:76:21)
# Node.js v20.11.1
# Subtest: C:\\SeanCode\\GolfHomiez\\golfhomiez\\test\\app.test.js
not ok 1 - C:\\SeanCode\\GolfHomiez\\golfhomiez\\test\\app.test.js
  ---
  duration_ms: 101.4536
  location: 'C:\\SeanCode\\GolfHomiez\\golfhomiez\\test\\app.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# Subtest: one-time schema rollback is wired into postinstall and removes itself afterward
ok 2 - one-time schema rollback is wired into postinstall and removes itself afterward
  ---
  duration_ms: 3.5473
  ...
# Subtest: rollback migration removes chat-added schema tables and migration records
ok 3 - rollback migration removes chat-added schema tables and migration records
  ---
  duration_ms: 2.1612
  ...
1..3
# tests 3
# suites 0
# pass 2
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 149.3745
