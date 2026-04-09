import { createAuthClient } from 'better-auth/react'

function resolveAuthBaseUrl() {
  const configured = import.meta.env.VITE_AUTH_BASE_URL
  if (configured) return configured
  if (typeof window !== 'undefined') return new URL('/api/auth', window.location.origin).toString()
  return '/api/auth'
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseUrl(),
  fetchOptions: {
    credentials: 'include',
  },
})
