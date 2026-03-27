import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import NavBar from './components/NavBar'
import { AuthProvider } from './context/AuthContext'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import GolfLogger from './pages/GolfLogger'
import SoloLogger from './pages/SoloLogger'
import Directions from './pages/Directions'
import Teams from './pages/Teams'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import MyGolfScores from './pages/MyGolfScores'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <AuthProvider>
      <BootMilestones />
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/golf-logger" element={<ProtectedRoute><GolfLogger /></ProtectedRoute>} />
        <Route path="/solo-logger" element={<ProtectedRoute><SoloLogger /></ProtectedRoute>} />
        <Route path="/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
        <Route path="/directions" element={<Directions />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/request-password-reset" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/my-golf-scores" element={<ProtectedRoute><MyGolfScores /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}


function BootMilestones() {
  const location = useLocation()

  useEffect(() => {
    import('./lib/frontend-logger').then(({ logFrontendEvent }) => {
      logFrontendEvent('app_component_mounted')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    import('./lib/frontend-logger').then(({ logFrontendEvent }) => {
      logFrontendEvent('route_changed', { pathname: location.pathname, search: location.search })
    }).catch(() => {})
  }, [location.pathname, location.search])

  return null
}
