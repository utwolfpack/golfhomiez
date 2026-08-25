import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  assertPasswordPolicy,
  getPasswordPolicyFailures,
  validatePasswordPolicy,
} from '../server/lib/password-policy.js'

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('password policy requires ten characters with uppercase, lowercase, and numeric characters', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 10)
  assert.match(PASSWORD_POLICY_MESSAGE, /at least 10 characters/i)
  assert.match(PASSWORD_POLICY_MESSAGE, /uppercase/i)
  assert.match(PASSWORD_POLICY_MESSAGE, /lowercase/i)
  assert.match(PASSWORD_POLICY_MESSAGE, /number/i)

  assert.deepEqual(getPasswordPolicyFailures('short'), ['minimum_length', 'uppercase', 'number'])
  assert.deepEqual(getPasswordPolicyFailures('alllowercase1'), ['uppercase'])
  assert.deepEqual(getPasswordPolicyFailures('ALLUPPERCASE1'), ['lowercase'])
  assert.deepEqual(getPasswordPolicyFailures('NoNumbersHere'), ['number'])
  assert.equal(validatePasswordPolicy('GolfHomiez1').ok, true)
  assert.doesNotThrow(() => assertPasswordPolicy('GolfHomiez1'))
  assert.throws(() => assertPasswordPolicy('golfhomiez'), /at least 10 characters.*uppercase.*lowercase.*number/i)
})

test('golf course login and reset request pages use golf course wording and expose account creation', async () => {
  const login = await read('src/pages/HostLogin.tsx')
  const forgot = await read('src/pages/HostForgotPassword.tsx')

  assert.match(login, /title="Sign in to your golf course portal"/)
  assert.match(login, /manage your golf course portal/)
  assert.match(login, /Golf course login/)
  assert.match(login, /Forgot golf course password\?/)
  assert.match(login, /to="\/host\/register"/)
  assert.match(login, /Create Golf Course Account/)
  assert.match(login, /background: '#ffffff'/)
  assert.match(login, /create_golf_course_account_selected/)
  assert.doesNotMatch(login, /Host login|Host password|host portal/)

  assert.match(forgot, /eyebrow="Golf course password reset"/)
  assert.match(forgot, /Back to golf course login/)
  assert.doesNotMatch(forgot, /Host password reset|Back to host login/)
  assert.match(forgot, /golf_course_password_reset_request_started/)
  assert.match(forgot, /golf_course_password_reset_request_succeeded/)
  assert.match(forgot, /golf_course_password_reset_request_failed/)
})

test('every account password creation and reset surface applies the shared password criteria', async () => {
  const files = [
    'src/pages/Register.tsx',
    'src/pages/ResetPassword.tsx',
    'src/pages/CreateHostAccount.tsx',
    'src/pages/HostResetPassword.tsx',
    'src/pages/HostPortal.tsx',
    'src/pages/OrganizerRegister.tsx',
    'src/pages/OrganizerResetPassword.tsx',
    'src/pages/AdminPortal.tsx',
    'src/pages/AdminResetPassword.tsx',
  ]

  for (const file of files) {
    const source = await read(file)
    assert.match(source, /PasswordCriteria/, `${file} should display password criteria`)
    assert.match(source, /minLength=\{10\}/, `${file} should use a 10-character HTML minimum`)
  }

  for (const file of files) {
    const source = await read(file)
    assert.doesNotMatch(source, /at least 8|minLength=\{8\}|password\.length < 8/i, `${file} should not retain the old eight-character policy`)
  }
})

test('server enforces password complexity for user, golf course, organizer, and admin accounts', async () => {
  const auth = await read('server/auth.js')
  const admin = await read('server/lib/admin-portal.js')
  const host = await read('server/lib/host-auth.js')
  const organizer = await read('server/lib/organizer-auth.js')
  const server = await read('server/index.js')
  const validation = await read('server/lib/validation.js')

  assert.match(auth, /minPasswordLength: PASSWORD_MIN_LENGTH/)
  assert.match(auth, /hooks:\s*\{[\s\S]*before: createAuthMiddleware/)
  assert.match(auth, /'\/sign-up\/email'/)
  assert.match(auth, /'\/reset-password'/)
  assert.match(auth, /'\/change-password'/)
  assert.match(auth, /auth_password_policy_rejected/)
  assert.match(auth, /x-correlation-id/)

  assert.match(admin, /assertPasswordPolicy\(password\)/)
  assert.match(admin, /assertPasswordPolicy\(nextPassword\)/)
  assert.match(admin, /assertPasswordPolicy\(normalizedPassword\)/)
  assert.match(host, /assertPasswordPolicy\(password\)/)
  assert.match(organizer, /assertPasswordPolicy\(password\)/)
  assert.match(validation, /validatePasswordPolicy\(normalizedPassword\)/)

  assert.match(server, /function rejectPasswordPolicy/)
  assert.match(server, /password_policy_rejected/)
  assert.match(server, /\.\.\.requestContext\(req\)/)
  assert.match(server, /'golf_course', 'request_account'/)
  assert.match(server, /'golf_course', 'reset_password'/)
  assert.match(server, /'organizer', 'register_account'/)
  assert.match(server, /'organizer', 'reset_password'/)
  assert.match(server, /'admin', 'create_account'/)
  assert.match(server, /'admin', 'reset_password'/)

  for (const source of [auth, admin, host, organizer, server, validation]) {
    assert.doesNotMatch(source, /Password must be at least 8 characters|password\.length < 8/i)
  }
})

test('golf course reset email and reset UI use golf course terminology', async () => {
  const hostAuth = await read('server/lib/host-auth.js')
  const reset = await read('src/pages/HostResetPassword.tsx')

  assert.match(hostAuth, /Reset your GolfHomiez golf course password/)
  assert.match(hostAuth, /Reset your golf course password:/)
  assert.match(reset, /Set a new golf course password/)
  assert.match(reset, /Update golf course password/)
  assert.match(reset, /Back to golf course login/)
  assert.doesNotMatch(reset, /new host password|Update host password|Back to host login/)
})
