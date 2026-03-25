export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

export function isValidPastOrTodayDate(dateStr) {
  const value = String(dateStr || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const dt = new Date(`${value}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return dt.getTime() <= today.getTime()
}

export function validateCredentials({ email, password, name, requireName = false }) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return { ok: false, message: 'Email is required' }
  if (!isEmail(normalizedEmail)) return { ok: false, message: 'Valid email is required' }

  const normalizedPassword = String(password || '')
  if (!normalizedPassword) return { ok: false, message: 'Password is required' }
  if (normalizedPassword.length < 8) return { ok: false, message: 'Password must be at least 8 characters' }

  const normalizedName = String(name || '').trim()
  if (requireName && !normalizedName) return { ok: false, message: 'Name is required' }

  return {
    ok: true,
    data: {
      email: normalizedEmail,
      password: normalizedPassword,
      name: normalizedName || null,
    },
  }
}
