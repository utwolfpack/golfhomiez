import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'

export type User = { id: string; email: string }

type AuthState = {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  register: (email: string, password: string) => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const token = localStorage.getItem('auth_token')
      if (!token) { setLoading(false); return }
      try {
        const me = await api<{ user: User }>('/api/auth/me')
        setUser(me.user)
      } catch {
        localStorage.removeItem('auth_token')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    async login(username, password) {
      const res = await api<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
      localStorage.setItem('auth_token', res.token)
      setUser(res.user)
    },
    logout() {
      // best-effort server-side session cleanup (still works offline if server already stopped)
      ;(async () => {
        try { await api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }) } catch {}
      })()
      localStorage.removeItem('auth_token')
      setUser(null)
    },
    async register(email, password) {
      await api<{ message: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      })
    }
  }), [user, loading])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
