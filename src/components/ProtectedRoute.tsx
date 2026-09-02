import React from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, roles }: { children: React.ReactNode, roles?: string[] }) {
  const location = useLocation()
  const { user, loading, hasRole, needsProfileEnrichment, profileStatusLoading, billingStatus, billingStatusLoading } = useAuth()
  if (loading || profileStatusLoading || billingStatusLoading) return <div className="container"><div className="card">Loading...</div></div>
  if (!user) return <Navigate to="/login" replace />
  if (needsProfileEnrichment && location.pathname !== '/profile') return <Navigate to="/profile?enrich=1" replace />
  if (billingStatus?.enabled && (!billingStatus.accessAllowed || !billingStatus.setupComplete) && !['/profile', '/profile/billing'].includes(location.pathname)) return <Navigate to="/profile/billing" replace />
  if (roles?.length && !roles.some((role) => hasRole(role))) return <Navigate to="/" replace />
  return <>{children}</>
}
