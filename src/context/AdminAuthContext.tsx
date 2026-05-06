import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { adminLogin, adminLogout, fetchAdminSession, type AdminUser } from '../lib/admin'

type AdminAuthState = {
  adminUser: AdminUser | null
  loading: boolean
  refreshAdminSession: () => Promise<void>
  loginAdmin: (username: string, password: string) => Promise<AdminUser>
  logoutAdmin: () => Promise<void>
}

const AdminAuthContext = createContext<AdminAuthState | null>(null)

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshAdminSession() {
    const result = await fetchAdminSession().catch(() => ({ adminUser: null as AdminUser | null }))
    setAdminUser(result?.adminUser || null)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await fetchAdminSession().catch(() => ({ adminUser: null as AdminUser | null }))
        if (active) setAdminUser(result?.adminUser || null)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const value = useMemo<AdminAuthState>(() => ({
    adminUser,
    loading,
    refreshAdminSession,
    async loginAdmin(username, password) {
      const result = await adminLogin(username, password)
      if (!result?.adminUser) throw new Error('Admin login failed')
      setAdminUser(result.adminUser)
      return result.adminUser
    },
    async logoutAdmin() {
      await adminLogout()
      setAdminUser(null)
    },
  }), [adminUser, loading])

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const value = useContext(AdminAuthContext)
  if (!value) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return value
}
