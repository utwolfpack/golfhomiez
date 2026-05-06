import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getHostSession, HostAccount, loginHostAccount, logoutHostAccount, redeemHostInviteAccount } from '../lib/host-auth'
import { logFrontendEvent } from '../lib/frontend-logger'

type HostAuthState = {
  hostAccount: HostAccount | null
  loading: boolean
  refreshHostSession: () => Promise<void>
  loginHost: (email: string, password: string) => Promise<void>
  registerHost: (payload: { email: string; golfCourseName: string; securityKey: string; password: string }) => Promise<void>
  logoutHost: () => Promise<void>
}

const HostAuthContext = createContext<HostAuthState | null>(null)

export function HostAuthProvider({ children }: { children: React.ReactNode }) {
  const [hostAccount, setHostAccount] = useState<HostAccount | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshHostSession() {
    const result = await getHostSession()
    setHostAccount(result.data?.hostAccount || null)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await getHostSession()
        if (active) setHostAccount(result.data?.hostAccount || null)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!hostAccount) return
    let lastRefreshAt = 0
    const refreshOnActivity = () => {
      const now = Date.now()
      if (now - lastRefreshAt < 60_000) return
      lastRefreshAt = now
      logFrontendEvent({ category: 'host.auth.session', message: 'activity_ttl_refresh_started', data: { hostAccountId: hostAccount.id } })
      void refreshHostSession()
    }
    const events = ['click', 'keydown', 'focus', 'visibilitychange']
    events.forEach((eventName) => globalThis.addEventListener?.(eventName, refreshOnActivity, { passive: true }))
    return () => events.forEach((eventName) => globalThis.removeEventListener?.(eventName, refreshOnActivity))
  }, [hostAccount?.id])

  const value = useMemo<HostAuthState>(() => ({
    hostAccount,
    loading,
    refreshHostSession,
    async loginHost(email, password) {
      const result = await loginHostAccount({ email, password })
      if (!result.response.ok) throw new Error(result.data && 'message' in (result.data as any) ? (result.data as any).message : 'Host login failed')
      setHostAccount(result.data?.hostAccount || null)
    },
    async registerHost(payload) {
      const result = await redeemHostInviteAccount(payload)
      if (!result.response.ok) throw new Error(result.data && 'message' in (result.data as any) ? (result.data as any).message : 'Host registration failed')
      setHostAccount(result.data?.hostAccount || null)
    },
    async logoutHost() {
      await logoutHostAccount()
      setHostAccount(null)
    },
  }), [hostAccount, loading])

  return <HostAuthContext.Provider value={value}>{children}</HostAuthContext.Provider>
}

export function useHostAuth() {
  const value = useContext(HostAuthContext)
  if (!value) throw new Error('useHostAuth must be used within HostAuthProvider')
  return value
}
