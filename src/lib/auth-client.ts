import { createAuthClient } from 'better-auth/react'

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function normalizeUrl(url: string) {
  return url.replace(/\/$/, '')
}

function getAuthBaseUrl() {
  const raw = String(import.meta.env.VITE_AUTH_BASE_URL || '').trim()
  const sameOriginDefault = '/api/auth'

  if (typeof window === 'undefined') {
    return normalizeUrl(raw || sameOriginDefault)
  }

  const pageUrl = new URL(window.location.origin)
  if (!raw) {
    return normalizeUrl(new URL(sameOriginDefault, pageUrl).toString())
  }

  const targetUrl = new URL(raw, window.location.origin)
  const pageIsLoopback = isLoopbackHost(pageUrl.hostname)
  const targetIsLoopback = isLoopbackHost(targetUrl.hostname)

  if (pageIsLoopback && targetIsLoopback) {
    targetUrl.protocol = pageUrl.protocol
    targetUrl.hostname = pageUrl.hostname
    return normalizeUrl(targetUrl.toString())
  }

  if (pageUrl.origin !== targetUrl.origin && (!pageIsLoopback || !targetIsLoopback)) {
    return normalizeUrl(new URL(sameOriginDefault, pageUrl).toString())
  }

  return normalizeUrl(targetUrl.toString())
}

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  fetchOptions: {
    credentials: 'include',
  },
})
