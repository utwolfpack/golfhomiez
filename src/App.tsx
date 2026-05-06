import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import NavBar from './components/NavBar'
import { AuthProvider, useAuth } from './context/AuthContext'
import { HostAuthProvider, useHostAuth } from './context/HostAuthContext'
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext'
import { OrganizerAuthProvider, useOrganizerAuth } from './context/OrganizerAuthContext'
import AdminPortal from './pages/AdminPortal'
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
import MyTournaments from './pages/MyTournaments'
import VerifyContact from './pages/VerifyContact'
import Profile from './pages/Profile'
import CreateHostAccount from './pages/CreateHostAccount'
import OrganizerLogin from './pages/OrganizerLogin'
import OrganizerRegister from './pages/OrganizerRegister'
import OrganizerTournaments from './pages/OrganizerTournaments'
import RedeemHostInvite from './pages/RedeemHostInvite'
import HostLogin from './pages/HostLogin'
import HostForgotPassword from './pages/HostForgotPassword'
import HostResetPassword from './pages/HostResetPassword'
import HostPortal from './pages/HostPortal'
import TournamentPortal from './pages/TournamentPortal'
import ProtectedRoute from './components/ProtectedRoute'
import HostProtectedRoute from './components/HostProtectedRoute'
import { emitFrontendStage } from './lib/frontend-logger'

function LoadingCard() {
  return <div className="container"><div className="card">Loading...</div></div>
}

function RouteDiagnostics() {
  const location = useLocation()

  useEffect(() => {
    emitFrontendStage(`route:${location.pathname}`)
  }, [location.pathname])

  return null
}

function ProfileEnrichmentGate() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, loading, needsProfileEnrichment, profileStatusLoading } = useAuth()

  useEffect(() => {
    if (loading || profileStatusLoading || !user || !needsProfileEnrichment) return
    if (location.pathname === '/profile') return
    navigate('/profile?enrich=1', { replace: true })
  }, [loading, profileStatusLoading, user, needsProfileEnrichment, location.pathname, navigate])

  return null
}

function LoginEntryRoute({ mode, children }: { mode: 'user' | 'host' | 'organizer'; children: JSX.Element }) {
  const { user, loading, roles } = useAuth()
  const { hostAccount, loading: hostLoading } = useHostAuth()
  const { adminUser, loading: adminLoading } = useAdminAuth()
  const { organizerAccount, loading: organizerLoading } = useOrganizerAuth()

  if (loading || hostLoading || adminLoading || organizerLoading) return <LoadingCard />
  if (mode === 'organizer') return organizerAccount ? <Navigate to="/organizer/portal" replace /> : children
  if (mode === 'host') return hostAccount ? <Navigate to="/host/portal" replace /> : children
  if (adminUser) return <Navigate to="/golfadmin" replace />
  if (user) return <Navigate to="/" replace />
  return children
}


function OrganizerProtectedRoute({ children }: { children: JSX.Element }) {
  const { organizerAccount, loading } = useOrganizerAuth()
  if (loading) return <LoadingCard />
  if (!organizerAccount) return <Navigate to="/organizer/login" replace />
  return children
}

function AdminEntryRoute({ children }: { children: JSX.Element }) {
  const { user, loading, roles } = useAuth()
  const { hostAccount, loading: hostLoading } = useHostAuth()
  const { adminUser, loading: adminLoading } = useAdminAuth()

  if (loading || hostLoading || adminLoading) return <LoadingCard />
  if (adminUser) return children
  if (hostAccount) return <Navigate to="/host/portal" replace />
  if (user) {
    if (roles.includes('organizer')) return <Navigate to="/organizer/portal" replace />
    return <Navigate to="/" replace />
  }
  return children
}

export default function App() {
  useEffect(() => {
    emitFrontendStage('app_mounted')
  }, [])

  return (
    <AuthProvider>
      <AdminAuthProvider>
        <OrganizerAuthProvider>
          <HostAuthProvider>
            <RouteDiagnostics />
            <ProfileEnrichmentGate />
            <NavBar />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/golf-logger" element={<ProtectedRoute><GolfLogger /></ProtectedRoute>} />
              <Route path="/solo-logger" element={<ProtectedRoute><SoloLogger /></ProtectedRoute>} />
              <Route path="/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/directions" element={<Directions />} />
              <Route path="/login" element={<LoginEntryRoute mode="user"><Login /></LoginEntryRoute>} />
              <Route path="/register" element={<Suspense fallback={<div className="container pageStack"><div className="card pageCardShell">Loading…</div></div>}><Register /></Suspense>} />
              <Route path="/verify-contact" element={<VerifyContact />} />
              <Route path="/request-password-reset" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/my-golf-scores" element={<ProtectedRoute><MyGolfScores /></ProtectedRoute>} />
              <Route path="/my-tournaments" element={<ProtectedRoute><MyTournaments /></ProtectedRoute>} />
              <Route path="/host/register" element={<CreateHostAccount />} />
              <Route path="/host/redeem" element={<RedeemHostInvite />} />
              <Route path="/host/login" element={<LoginEntryRoute mode="host"><HostLogin /></LoginEntryRoute>} />
              <Route path="/host/request-password-reset" element={<HostForgotPassword />} />
              <Route path="/host/reset-password" element={<HostResetPassword />} />
              <Route path="/host/portal" element={<HostProtectedRoute><HostPortal /></HostProtectedRoute>} />
              <Route path="/organizer/register" element={<LoginEntryRoute mode="organizer"><Suspense fallback={<div className="container pageStack"><div className="card pageCardShell">Loading…</div></div>}><OrganizerRegister /></Suspense></LoginEntryRoute>} />
              <Route path="/organizer/login" element={<LoginEntryRoute mode="organizer"><OrganizerLogin /></LoginEntryRoute>} />
              <Route path="/organizer/portal" element={<OrganizerProtectedRoute><OrganizerTournaments /></OrganizerProtectedRoute>} />
              <Route path="/tournaments/:id" element={<TournamentPortal />} />
              <Route path="/golfadmin" element={<AdminEntryRoute><AdminPortal /></AdminEntryRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HostAuthProvider>
        </OrganizerAuthProvider>
      </AdminAuthProvider>
    </AuthProvider>
  )
}
