import React from 'react'
import { Navigate } from 'react-router-dom'
import { useHostAuth } from '../context/HostAuthContext'

export default function HostProtectedRoute({ children }: { children: React.ReactNode }) {
  const { hostAccount, loading } = useHostAuth()
  if (loading) return <div className="container"><div className="card">Loading...</div></div>
  if (!hostAccount) return <Navigate to="/host/login" replace />
  return <>{children}</>
}
