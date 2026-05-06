import React from 'react'
import { Navigate } from 'react-router-dom'
import { useOrganizerAuth } from '../context/OrganizerAuthContext'

export default function OrganizerProtectedRoute({ children }: { children: React.ReactNode }) {
  const { organizerAccount, loading } = useOrganizerAuth()
  if (loading) return <div className="container"><div className="card">Loading...</div></div>
  if (!organizerAccount) return <Navigate to="/organizer/login" replace />
  return <>{children}</>
}
