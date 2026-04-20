const latestResetsByEmail = new Map()
const latestVerificationByEmail = new Map()

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

export function setLatestVerificationLink({ email, token, url, callbackURL }) {
  const key = normalizeEmail(email)
  if (!key) return
  latestVerificationByEmail.set(key, {
    email: key,
    token,
    url,
    callbackURL: callbackURL || null,
    createdAt: new Date().toISOString(),
  })
}

export function getLatestVerificationLink(email) {
  const key = normalizeEmail(email)
  if (!key) return null
  return latestVerificationByEmail.get(key) || null
}
