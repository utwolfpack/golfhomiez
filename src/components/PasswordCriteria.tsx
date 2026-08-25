import { getPasswordPolicyFailures } from '../lib/password-policy'

export default function PasswordCriteria({ password = '' }: { password?: string }) {
  const failures = new Set(getPasswordPolicyFailures(password))
  const criteria = [
    ['minimum_length', 'At least 10 characters'],
    ['uppercase', 'At least one uppercase letter'],
    ['lowercase', 'At least one lowercase letter'],
    ['number', 'At least one number'],
  ] as const

  return (
    <div className="small" aria-live="polite">
      <strong>Password criteria</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
        {criteria.map(([key, label]) => (
          <li key={key}>{password ? (failures.has(key) ? '○ ' : '✓ ') : ''}{label}</li>
        ))}
      </ul>
    </div>
  )
}
