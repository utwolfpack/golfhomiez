import { requestJson } from './request'

export type SessionUser = { id: string; email: string; name?: string | null }

type AuthResult<T> = { data?: T; error?: { message?: string } }

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function normalizeUrl(url: string) {
  return url.replace(/\/$/, '')
}

function getAuthBase() {
  const raw = String(import.meta.env.VITE_AUTH_BASE_URL || '').trim()
  const sameOriginDefault = '/api/auth'

  if (typeof window === 'undefined') return normalizeUrl(raw || sameOriginDefault)

  const pageUrl = new URL(window.location.origin)
  if (!raw) return normalizeUrl(new URL(sameOriginDefault, pageUrl).toString())

  const targetUrl = new URL(raw, window.location.origin)
  const pageIsLoopback = isLoopbackHost(pageUrl.hostname)
  const targetIsLoopback = isLoopbackHost(targetUrl.hostname)

  if (pageIsLoopback && targetIsLoopback && pageUrl.port === targetUrl.port) {
    targetUrl.protocol = pageUrl.protocol
    targetUrl.hostname = pageUrl.hostname
    return normalizeUrl(targetUrl.toString())
  }

  if (!pageIsLoopback && targetIsLoopback) {
    return normalizeUrl(new URL(sameOriginDefault, pageUrl).toString())
  }

  return normalizeUrl(targetUrl.toString())
}

const AUTH_BASE = getAuthBase()

async function parseResponse<T>(url: string, opts: RequestInit): Promise<AuthResult<T>> {
  const { data, response } = await requestJson<T>(url, opts)
  if (!response.ok) {
    return {
      error: { message: (data as { message?: string; error?: { message?: string } } | null)?.message || (data as { error?: { message?: string } } | null)?.error?.message || `Request failed (${response.status})` },
    }
  }
  return { data: data as T }
}

export async function signUpEmail(email: string, password: string, name: string) {
  return parseResponse(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  })
}

export async function signInEmail(email: string, password: string) {
  return parseResponse(`${AUTH_BASE}/sign-in/email`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function signOutAuth() {
  return parseResponse(`${AUTH_BASE}/sign-out`, {
    method: 'POST',
  })
}

export async function getSessionAuth() {
  return parseResponse<{ session: unknown; user: SessionUser } | null>(`${AUTH_BASE}/get-session`, {
    method: 'GET',
  })
}

export async function forgotPassword(email: string, redirectTo: string) {
  return parseResponse<{ ok?: boolean }>(`${AUTH_BASE}/request-password-reset`, {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo }),
  })
}

export async function resetPassword(token: string, newPassword: string) {
  return parseResponse<{ ok?: boolean }>(`${AUTH_BASE}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  })
}

export async function getLatestResetLink(email: string) {
  const url = new URL('/api/auth-debug/latest-reset', window.location.origin)
  url.searchParams.set('email', email)
  return parseResponse<{ email: string; token: string; url: string; expiresAt?: string | null } | null>(url.toString(), {
    method: 'GET',
  })
}
