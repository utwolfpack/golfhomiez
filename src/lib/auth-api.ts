export type SessionUser = { id: string; email: string; name?: string | null }

type AuthResult<T> = { data?: T; error?: { message?: string } }

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function getAuthBase() {
  const raw = String(import.meta.env.VITE_AUTH_BASE_URL || '/api/auth').trim()
  if (typeof window === 'undefined') return raw.replace(/\/$/, '')

  const pageUrl = new URL(window.location.origin)
  const targetUrl = new URL(raw, window.location.origin)

  if (isLoopbackHost(pageUrl.hostname) && isLoopbackHost(targetUrl.hostname) && pageUrl.port === targetUrl.port) {
    targetUrl.protocol = pageUrl.protocol
    targetUrl.hostname = pageUrl.hostname
  }

  return targetUrl.toString().replace(/\/$/, '')
}

const AUTH_BASE = getAuthBase()

async function parseResponse<T>(res: Response): Promise<AuthResult<T>> {
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    return {
      error: { message: data?.message || data?.error?.message || `Request failed (${res.status})` },
    }
  }
  return { data: data as T }
}

export async function signUpEmail(email: string, password: string, name: string) {
  const res = await fetch(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      name,
    }),
    credentials: 'include',
  })
  return parseResponse(res)
}

export async function signInEmail(email: string, password: string) {
  const res = await fetch(`${AUTH_BASE}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
    }),
    credentials: 'include',
  })
  return parseResponse(res)
}

export async function signOutAuth() {
  const res = await fetch(`${AUTH_BASE}/sign-out`, {
    method: 'POST',
    credentials: 'include',
  })
  return parseResponse(res)
}

export async function getSessionAuth() {
  const res = await fetch(`${AUTH_BASE}/get-session`, {
    method: 'GET',
    credentials: 'include',
  })
  return parseResponse<{ session: unknown; user: SessionUser } | null>(res)
}

export async function forgotPassword(email: string, redirectTo: string) {
  const res = await fetch(`${AUTH_BASE}/forget-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, redirectTo }),
  })
  return parseResponse<{ ok?: boolean }>(res)
}

export async function resetPassword(token: string, newPassword: string) {
  const res = await fetch(`${AUTH_BASE}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token, newPassword }),
  })
  return parseResponse<{ ok?: boolean }>(res)
}

export async function getLatestResetLink(email: string) {
  const url = new URL('/api/auth-debug/latest-reset', window.location.origin)
  url.searchParams.set('email', email)
  const res = await fetch(url.toString(), { credentials: 'include' })
  return parseResponse<{ email: string; token: string; url: string; expiresAt?: string | null } | null>(res)
}
