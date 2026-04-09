import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import NavBar from './components/NavBar'
import { AuthProvider } from './context/AuthContext'
import Home from './pages/Home'
import Login from './pages/Login'
const Register = lazy(() => import('./pages/Register'))
import GolfLogger from './pages/GolfLogger'
import SoloLogger from './pages/SoloLogger'
import Directions from './pages/Directions'
import Teams from './pages/Teams'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import MyGolfScores from './pages/MyGolfScores'
import VerifyContact from './pages/VerifyContact'
import ProtectedRoute from './components/ProtectedRoute'
import { emitFrontendStage } from './lib/frontend-logger'

function RouteDiagnostics() {
  const location = useLocation()

  useEffect(() => {
    emitFrontendStage(`route:${location.pathname}`)
  }, [location.pathname])

  return null
}

export default function App() {
  useEffect(() => {
    emitFrontendStage('app_mounted')
  }, [])

  return (
    <AuthProvider>
      <RouteDiagnostics />
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/golf-logger" element={<ProtectedRoute><GolfLogger /></ProtectedRoute>} />
        <Route path="/solo-logger" element={<ProtectedRoute><SoloLogger /></ProtectedRoute>} />
        <Route path="/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
        <Route path="/directions" element={<Directions />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Suspense fallback={<div className="container pageStack"><div className="card pageCardShell">Loading…</div></div>}><Register /></Suspense>} />
        <Route path="/verify-contact" element={<VerifyContact />} />
        <Route path="/request-password-reset" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/my-golf-scores" element={<ProtectedRoute><MyGolfScores /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
