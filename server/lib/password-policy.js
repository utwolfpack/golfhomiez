export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_POLICY_MESSAGE = 'Password must be at least 10 characters and include at least one uppercase letter, one lowercase letter, and one number.'

export function getPasswordPolicyFailures(password) {
  const value = String(password || '')
  const failures = []
  if (value.length < PASSWORD_MIN_LENGTH) failures.push('minimum_length')
  if (!/[A-Z]/.test(value)) failures.push('uppercase')
  if (!/[a-z]/.test(value)) failures.push('lowercase')
  if (!/[0-9]/.test(value)) failures.push('number')
  return failures
}

export function validatePasswordPolicy(password) {
  const failures = getPasswordPolicyFailures(password)
  return {
    ok: failures.length === 0,
    failures,
    message: failures.length ? PASSWORD_POLICY_MESSAGE : null,
  }
}

export function assertPasswordPolicy(password) {
  const result = validatePasswordPolicy(password)
  if (!result.ok) {
    const error = new Error(PASSWORD_POLICY_MESSAGE)
    error.code = 'PASSWORD_POLICY_FAILED'
    error.failures = result.failures
    throw error
  }
  return String(password)
}
