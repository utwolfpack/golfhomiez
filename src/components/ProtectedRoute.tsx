import React from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, roles }: { children: React.ReactNode, roles?: string[] }) {
  const location = useLocation()
  const { user, loading, hasRole, needsProfileEnrichment, billingStatus } = useAuth()
  // Only the initial auth bootstrap should replace protected page content with
  // a loading view. Background profile/billing refreshes happen on ordinary
  // activity and mobile visibility changes; unmounting the protected page for
  // those refreshes destroys transient score-entry UI state. The last known
  // authorization/profile/billing state remains in force until refresh data
  // arrives, at which point the redirect checks below react normally.
  if (loading) return <div className="container"><div className="card">Loading...</div></div>
  if (!user) return <Navigate to="/login" replace />
  if (needsProfileEnrichment && location.pathname !== '/profile') return <Navigate to="/profile?enrich=1" replace />
  if (billingStatus?.enabled && (!billingStatus.accessAllowed || !billingStatus.setupComplete) && !['/profile', '/profile/billing'].includes(location.pathname)) return <Navigate to="/profile/billing" replace />
  if (roles?.length && !roles.some((role) => hasRole(role))) return <Navigate to="/" replace />
  return <>{children}</>
}
