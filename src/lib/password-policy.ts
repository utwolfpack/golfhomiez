export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_POLICY_MESSAGE = 'Password must be at least 10 characters and include at least one uppercase letter, one lowercase letter, and one number.'

export type PasswordPolicyFailure = 'minimum_length' | 'uppercase' | 'lowercase' | 'number'

export function getPasswordPolicyFailures(password: string): PasswordPolicyFailure[] {
  const failures: PasswordPolicyFailure[] = []
  if (password.length < PASSWORD_MIN_LENGTH) failures.push('minimum_length')
  if (!/[A-Z]/.test(password)) failures.push('uppercase')
  if (!/[a-z]/.test(password)) failures.push('lowercase')
  if (!/[0-9]/.test(password)) failures.push('number')
  return failures
}

export function validatePasswordPolicy(password: string) {
  const failures = getPasswordPolicyFailures(password)
  return {
    ok: failures.length === 0,
    failures,
    message: failures.length ? PASSWORD_POLICY_MESSAGE : null,
  }
}

export function assertPasswordPolicy(password: string) {
  const result = validatePasswordPolicy(password)
  if (!result.ok) throw new Error(PASSWORD_POLICY_MESSAGE)
  return password
}
