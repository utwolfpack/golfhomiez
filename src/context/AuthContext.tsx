import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getSessionAuth, signInEmail, signOutAuth, signUpEmail } from '../lib/auth-api'
import { logFrontendEvent } from '../lib/frontend-logger'

export type User = { id: string; email: string; name?: string | null }

type AuthState = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  register: (firstName: string, lastName: string, email: string, password: string) => Promise<void>
  refreshSession: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

function toUser(data: { user?: User } | null | undefined) {
  return data?.user ? { id: data.user.id, email: data.user.email, name: data.user.name } : null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshSession() {
    const result = await getSessionAuth()
    if (result.error) {
      logFrontendEvent({ level: 'warn', category: 'auth.session', message: 'refresh_session_failed', data: { error: result.error.message || null } })
      setUser(null)
      return
    }
    setUser(toUser(result.data))
    logFrontendEvent({ category: 'auth.session', message: 'refresh_session_succeeded', data: { hasUser: Boolean(result.data?.user) } })
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await getSessionAuth()
        if (!active) return
        if (result.error) {
          logFrontendEvent({ level: 'warn', category: 'auth.session', message: 'initial_session_failed', data: { error: result.error.message || null } })
        }
        setUser(toUser(result.data))
        logFrontendEvent({ category: 'auth.session', message: 'initial_session_checked', data: { hasUser: Boolean(result.data?.user) } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    async login(email, password) {
      const result = await signInEmail(email, password)
      if (result.error) throw new Error(result.error.message || 'Login failed')
      await refreshSession()
    },
    async logout() {
      const result = await signOutAuth()
      if (result.error) throw new Error(result.error.message || 'Logout failed')
      setUser(null)
    },
    async register(firstName, lastName, email, password) {
      const fullName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim() || email.split('@')[0]
      const result = await signUpEmail(email, password, fullName)
      if (result.error) throw new Error(result.error.message || 'Registration failed')
      await refreshSession()
    },
    refreshSession,
  }), [user, loading])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
