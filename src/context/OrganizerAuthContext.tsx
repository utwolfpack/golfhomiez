import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { OrganizerAccount } from '../lib/accounts'
import { getOrganizerSession, loginOrganizerAccount, logoutOrganizerAccount, registerOrganizerAccount } from '../lib/organizer-auth'
import { logFrontendEvent } from '../lib/frontend-logger'

type OrganizerAuthContextValue = {
  organizerAccount: OrganizerAccount | null
  organizerUser: OrganizerAccount | null
  loading: boolean
  isOrganizer: boolean
  refreshOrganizerSession: () => Promise<void>
  loginOrganizer: (email: string, password: string) => Promise<void>
  registerOrganizer: (payload: { firstName: string; lastName: string; email: string; password: string }) => Promise<void>
  logoutOrganizer: () => Promise<void>
}

const OrganizerAuthContext = createContext<OrganizerAuthContextValue | undefined>(undefined)

export function OrganizerAuthProvider({ children }: { children: React.ReactNode }) {
  const [organizerAccount, setOrganizerAccount] = useState<OrganizerAccount | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshOrganizerSession() {
    const result = await getOrganizerSession()
    setOrganizerAccount(result.data?.organizerAccount || null)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await getOrganizerSession()
        if (active) setOrganizerAccount(result.data?.organizerAccount || null)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!organizerAccount) return
    let lastRefreshAt = 0
    const refreshOnActivity = () => {
      const now = Date.now()
      if (now - lastRefreshAt < 60_000) return
      lastRefreshAt = now
      logFrontendEvent({ category: 'organizer.auth.session', message: 'activity_ttl_refresh_started', data: { organizerAccountId: organizerAccount.id } })
      void refreshOrganizerSession()
    }
    const events = ['click', 'keydown', 'focus', 'visibilitychange']
    events.forEach((eventName) => globalThis.addEventListener?.(eventName, refreshOnActivity, { passive: true }))
    return () => events.forEach((eventName) => globalThis.removeEventListener?.(eventName, refreshOnActivity))
  }, [organizerAccount?.id])

  const value = useMemo<OrganizerAuthContextValue>(() => ({
    organizerAccount,
    organizerUser: organizerAccount,
    loading,
    isOrganizer: Boolean(organizerAccount),
    refreshOrganizerSession,
    async loginOrganizer(email, password) {
      const result = await loginOrganizerAccount({ email, password })
      if (!result.response.ok) throw new Error(result.data && 'message' in (result.data as any) ? (result.data as any).message : 'Organizer login failed')
      setOrganizerAccount(result.data?.organizerAccount || null)
    },
    async registerOrganizer(payload) {
      const result = await registerOrganizerAccount(payload)
      if (!result.response.ok) throw new Error(result.data && 'message' in (result.data as any) ? (result.data as any).message : 'Organizer registration failed')
      setOrganizerAccount(result.data?.organizerAccount || null)
    },
    async logoutOrganizer() {
      await logoutOrganizerAccount()
      setOrganizerAccount(null)
    },
  }), [organizerAccount, loading])

  return (
    <OrganizerAuthContext.Provider value={value}>
      {children}
    </OrganizerAuthContext.Provider>
  )
}

export function useOrganizerAuth() {
  const context = useContext(OrganizerAuthContext)
  if (!context) {
    throw new Error('useOrganizerAuth must be used within OrganizerAuthProvider')
  }
  return context
}
