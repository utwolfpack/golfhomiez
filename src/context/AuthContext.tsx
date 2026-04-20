import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getSessionAuth, signInEmail, signOutAuth, signUpEmail } from '../lib/auth-api'
import { fetchProfile } from '../lib/profile'
import { fetchRbacSummary } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'

export type User = { id: string; email: string; name?: string | null }

type AuthState = {
  user: User | null
  loading: boolean
  needsProfileEnrichment: boolean
  profileStatusLoading: boolean
  roles: string[]
  hasRole: (role: string) => boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  register: (firstName: string, lastName: string, email: string, password: string) => Promise<{ email: string }>
  refreshSession: () => Promise<void>
  refreshProfileStatus: () => Promise<void>
  refreshRoles: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

function toUser(data: { user?: User } | null | undefined) {
  return data?.user ? { id: data.user.id, email: data.user.email, name: data.user.name } : null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsProfileEnrichment, setNeedsProfileEnrichment] = useState(false)
  const [profileStatusLoading, setProfileStatusLoading] = useState(false)
  const [roles, setRoles] = useState<string[]>([])

  async function refreshRoles(nextUser?: User | null) {
    const activeUser = nextUser ?? user
    if (!activeUser) {
      setRoles([])
      return
    }

    try {
      const summary = await fetchRbacSummary()
      const nextRoles = Array.isArray(summary.roles) ? summary.roles : []
      setRoles(nextRoles)
      logFrontendEvent({ category: 'auth.roles', message: 'roles_refreshed', data: { roles: nextRoles } })
    } catch (error) {
      setRoles([])
      logFrontendEvent({ level: 'warn', category: 'auth.roles', message: 'roles_refresh_failed', data: { error: error instanceof Error ? error.message : String(error) } })
    }
  }

  async function refreshProfileStatus(nextUser?: User | null) {
    const activeUser = nextUser ?? user
    if (!activeUser) {
      setNeedsProfileEnrichment(false)
      setProfileStatusLoading(false)
      return
    }

    setProfileStatusLoading(true)
    try {
      const profile = await fetchProfile()
      setNeedsProfileEnrichment(Boolean(profile.needsEnrichment))
      logFrontendEvent({ category: 'auth.profile', message: 'profile_status_refreshed', data: { needsEnrichment: Boolean(profile.needsEnrichment) } })
    } catch (error) {
      setNeedsProfileEnrichment(false)
      logFrontendEvent({ level: 'warn', category: 'auth.profile', message: 'profile_status_failed', data: { error: error instanceof Error ? error.message : String(error) } })
    } finally {
      setProfileStatusLoading(false)
    }
  }

  async function refreshSession() {
    const result = await getSessionAuth()
    if (result.error) {
      logFrontendEvent({ level: 'warn', category: 'auth.session', message: 'refresh_session_failed', data: { error: result.error.message || null } })
      setUser(null)
      setRoles([])
      setNeedsProfileEnrichment(false)
      setProfileStatusLoading(false)
      return
    }
    const nextUser = toUser(result.data)
    setUser(nextUser)
    logFrontendEvent({ category: 'auth.session', message: 'refresh_session_succeeded', data: { hasUser: Boolean(result.data?.user) } })
    await Promise.all([refreshProfileStatus(nextUser), refreshRoles(nextUser)])
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
        const nextUser = toUser(result.data)
        setUser(nextUser)
        logFrontendEvent({ category: 'auth.session', message: 'initial_session_checked', data: { hasUser: Boolean(result.data?.user) } })
        if (nextUser) {
          await Promise.all([refreshProfileStatus(nextUser), refreshRoles(nextUser)])
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    needsProfileEnrichment,
    profileStatusLoading,
    roles,
    hasRole(role: string) {
      return roles.includes(role)
    },
    async login(email, password) {
      const result = await signInEmail(email, password)
      if (result.error) throw new Error(result.error.message || 'Login failed')
      await refreshSession()
    },
    async logout() {
      const result = await signOutAuth()
      if (result.error) throw new Error(result.error.message || 'Logout failed')
      setUser(null)
      setRoles([])
      setNeedsProfileEnrichment(false)
    },
    async register(firstName, lastName, email, password) {
      const normalizedEmail = email.trim().toLowerCase()
      const fullName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim() || normalizedEmail.split('@')[0]
      const result = await signUpEmail(normalizedEmail, password, fullName)
      if (result.error) throw new Error(result.error.message || 'Registration failed')
      const signOutResult = await signOutAuth().catch((error) => ({ error: { message: error instanceof Error ? error.message : 'Sign out failed' } }))
      if (signOutResult?.error) {
        logFrontendEvent({ level: 'warn', category: 'auth.register', message: 'post_signup_signout_failed', data: { email: normalizedEmail, error: signOutResult.error.message || null } })
      }
      setUser(null)
      setRoles([])
      setNeedsProfileEnrichment(false)
      return { email: normalizedEmail }
    },
    refreshSession,
    refreshProfileStatus,
    refreshRoles,
  }), [user, loading, needsProfileEnrichment, profileStatusLoading, roles])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
