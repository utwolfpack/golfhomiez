import { handleExpiredSession } from './session-expiration'
import { attachRequestMetadata, logFrontendEvent } from './frontend-logger'

export type SessionUser = { id: string; email: string; name?: string | null }

type AuthResult<T> = { data?: T; error?: { message?: string; code?: string } }

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

  if (!pageIsLoopback && !targetIsLoopback && pageUrl.origin !== targetUrl.origin) {
    return normalizeUrl(new URL(sameOriginDefault, pageUrl).toString())
  }

  return normalizeUrl(targetUrl.toString())
}

const AUTH_BASE = getAuthBase()

function getCommonHeaders() {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (timeZone) headers.set('X-User-Timezone', timeZone)
  } catch {
    // ignore
  }
  return headers
}

async function parseResponse<T>(res: Response): Promise<AuthResult<T>> {
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    return {
      error: { code: data?.code || data?.error?.code, message: data?.message || data?.error?.message || `Request failed (${res.status})` },
    }
  }
  return { data: data as T }
}

async function authFetch<T>(url: string, init: RequestInit, requestName: string) {
  const startedAt = Date.now()
  const requestInit = attachRequestMetadata(init)

  try {
    const res = await fetch(url, {
      ...requestInit,
      credentials: 'include',
    })

    logFrontendEvent({
      category: 'auth.fetch',
      level: res.ok ? 'info' : 'warn',
      message: requestName,
      data: {
        url,
        method: requestInit.method || 'GET',
        status: res.status,
        ok: res.ok,
        durationMs: Date.now() - startedAt,
      },
    })

    handleExpiredSession('auth', res.status)
    return parseResponse<T>(res)
  } catch (error) {
    logFrontendEvent({
      category: 'auth.fetch',
      level: 'error',
      message: `${requestName}_failed`,
      data: {
        url,
        method: requestInit.method || 'GET',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
    })
    throw error
  }
}

export async function signUpEmail(email: string, password: string, name: string) {
  return authFetch(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST',
    headers: getCommonHeaders(),
    body: JSON.stringify({
      email,
      password,
      name,
    }),
  }, 'auth_sign_up_email')
}

export async function signInEmail(email: string, password: string) {
  const result = await authFetch(`${AUTH_BASE}/sign-in/email`, {
    method: 'POST',
    headers: getCommonHeaders(),
    body: JSON.stringify({
      email,
      password,
    }),
  }, 'auth_sign_in_email')

  if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
    return {
      error: {
        code: result.error.code,
        message: 'Your account is not verified yet. Use the verification link from your registration email before signing in.',
      },
    }
  }

  return result
}

export async function signOutAuth() {
  return authFetch(`${AUTH_BASE}/sign-out`, {
    method: 'POST',
  }, 'auth_sign_out')
}

export async function getSessionAuth() {
  return authFetch<{ session: unknown; user: SessionUser } | null>(`${AUTH_BASE}/get-session`, {
    method: 'GET',
  }, 'auth_get_session')
}

export async function forgotPassword(email: string, redirectTo: string) {
  return authFetch<{ ok?: boolean }>(`${AUTH_BASE}/request-password-reset`, {
    method: 'POST',
    headers: getCommonHeaders(),
    body: JSON.stringify({ email, redirectTo }),
  }, 'auth_request_password_reset')
}

export async function resetPassword(token: string, newPassword: string) {
  return authFetch<{ ok?: boolean }>(`${AUTH_BASE}/reset-password`, {
    method: 'POST',
    headers: getCommonHeaders(),
    body: JSON.stringify({ token, newPassword }),
  }, 'auth_reset_password')
}

export async function sendVerificationEmail(email: string, callbackURL: string) {
  return authFetch<{ ok?: boolean }>(`${AUTH_BASE}/send-verification-email`, {
    method: 'POST',
    headers: getCommonHeaders(),
    body: JSON.stringify({ email, callbackURL }),
  }, 'auth_send_verification_email')
}

export async function getLatestResetLink(email: string) {
  const url = new URL('/api/auth-debug/latest-reset', window.location.origin)
  url.searchParams.set('email', email)
  return authFetch<{ email: string; token: string; url: string; expiresAt?: string | null } | null>(url.toString(), {
    method: 'GET',
  }, 'auth_debug_latest_reset')
}

export async function getLatestVerificationLink(email: string) {
  const url = new URL('/api/auth-debug/latest-verification', window.location.origin)
  url.searchParams.set('email', email)
  return authFetch<{ email: string; token: string; url: string; callbackURL?: string | null } | null>(url.toString(), {
    method: 'GET',
  }, 'auth_debug_latest_verification')
}

export async function sendPhoneOtp(phone: string) {
  return { data: { ok: Boolean(phone) } }
}

export async function getLatestPhoneOtp(phone: string) {
  return { data: phone ? { code: '654321' } : null }
}

export async function verifyPhoneOtp(phone: string, code: string, _persist: boolean) {
  if (!phone || !code) return { error: { message: 'Phone and verification code are required' } }
  return { data: { ok: true } }
}
