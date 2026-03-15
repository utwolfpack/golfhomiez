const latestResetsByEmail = new Map()

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function setLatestPasswordReset({ email, token, url, expiresAt }) {
  const key = normalizeEmail(email)
  if (!key) return
  latestResetsByEmail.set(key, {
    email: key,
    token,
    url,
    expiresAt: expiresAt || null,
    createdAt: new Date().toISOString(),
  })
}

export function getLatestPasswordReset(email) {
  const key = normalizeEmail(email)
  if (!key) return null
  return latestResetsByEmail.get(key) || null
}
