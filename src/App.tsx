import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router'
import NavBar from './components/NavBar'
import { AuthProvider, useAuth } from './context/AuthContext'
import { HostAuthProvider, useHostAuth } from './context/HostAuthContext'
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext'
import { OrganizerAuthProvider, useOrganizerAuth } from './context/OrganizerAuthContext'
import AdminPortal from './pages/AdminPortal'
import AdminScheduledJobs from './pages/AdminScheduledJobs'
import AdminAccessCodes from './pages/AdminAccessCodes'
import AdminResetPassword from './pages/AdminResetPassword'
import Home from './pages/Home'
import { GolfHomiezCourseVideos, GolfHomiezVideos } from './pages/MarketingVideos'
import Login from './pages/Login'
const Register = lazy(() => import('./pages/Register'))
import SoloLogger from './pages/SoloLogger'
import Directions from './pages/Directions'
import Teams from './pages/Teams'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import MyGolfScores from './pages/MyGolfScores'
import MyTournaments from './pages/MyTournaments'
import FindTournament from './pages/FindTournament'
import FindCourse from './pages/FindCourse'
import VerifyContact from './pages/VerifyContact'
import Profile from './pages/Profile'
import Billing from './pages/Billing'
import CreateHostAccount from './pages/CreateHostAccount'
import OrganizerLogin from './pages/OrganizerLogin'
import OrganizerRegister from './pages/OrganizerRegister'
import OrganizerForgotPassword from './pages/OrganizerForgotPassword'
import OrganizerResetPassword from './pages/OrganizerResetPassword'
import OrganizerTournaments from './pages/OrganizerTournaments'
import OrganizerProfile from './pages/OrganizerProfile'
import HostLogin from './pages/HostLogin'
import HostForgotPassword from './pages/HostForgotPassword'
import HostResetPassword from './pages/HostResetPassword'
import HostPortal from './pages/HostPortal'
import HostProfile from './pages/HostProfile'
import Support from './pages/Support'
import Inbox from './pages/Inbox'
import Challenges from './pages/Challenges'
import InviteHomie from './pages/InviteHomie'
import TournamentPortal from './pages/TournamentPortal'
import TournamentLeaderboard from './pages/TournamentLeaderboard'
import TournamentPictures from './pages/TournamentPictures'
import GolfCoursePage from './pages/GolfCoursePage'
import GolfCourseCalendarPage from './pages/GolfCourseCalendarPage'
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

function AccountSetupGate() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, loading, needsProfileEnrichment, profileStatusLoading, billingStatus, billingStatusLoading } = useAuth()

  useEffect(() => {
    if (loading || profileStatusLoading || billingStatusLoading || !user) return
    if (needsProfileEnrichment) {
      if (location.pathname !== '/profile') navigate('/profile?enrich=1', { replace: true })
      return
    }
    if (billingStatus?.enabled && (!billingStatus.accessAllowed || !billingStatus.setupComplete)) {
      if (!['/profile', '/profile/billing'].includes(location.pathname)) navigate('/profile/billing', { replace: true })
    }
  }, [loading, profileStatusLoading, billingStatusLoading, user, needsProfileEnrichment, billingStatus, location.pathname, navigate])

  return null
}

function LoginEntryRoute({ mode, children }: { mode: 'user' | 'host' | 'organizer'; children: ReactElement }) {
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


function OrganizerProtectedRoute({ children }: { children: ReactElement }) {
  const { organizerAccount, loading } = useOrganizerAuth()
  if (loading) return <LoadingCard />
  if (!organizerAccount) return <Navigate to="/organizer/login" replace />
  return children
}

function AdminEntryRoute({ children }: { children: ReactElement }) {
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

function SupportAccessRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth()
  const { hostAccount, loading: hostLoading } = useHostAuth()
  const { organizerAccount, loading: organizerLoading } = useOrganizerAuth()

  if (loading || hostLoading || organizerLoading) return <LoadingCard />
  if (user || hostAccount || organizerAccount) return children
  return <Navigate to="/login" replace />
}

export default function App() {
  const location = useLocation()
  const tournamentLeaderboardDisplay = /^\/tournaments\/[^/]+\/leaderboard\/?$/.test(location.pathname)
    || /^\/tournaments\/[^/]+\/pictures\/?$/.test(location.pathname)

  useEffect(() => {
    emitFrontendStage('app_mounted')
  }, [])

  return (
    <AuthProvider>
      <AdminAuthProvider>
        <OrganizerAuthProvider>
          <HostAuthProvider>
            <RouteDiagnostics />
            {!tournamentLeaderboardDisplay ? <AccountSetupGate /> : null}
            {!tournamentLeaderboardDisplay ? <a className="skipLink" href="#main-content">Skip to main content</a> : null}
            {!tournamentLeaderboardDisplay ? <NavBar /> : null}
            <main id="main-content" className="appMain" tabIndex={-1}>
              <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/golfhomiezvideos" element={<GolfHomiezVideos />} />
              <Route path="/golfhomiezcoursevideos" element={<GolfHomiezCourseVideos />} />
              <Route path="/solo-logger" element={<ProtectedRoute><SoloLogger /></ProtectedRoute>} />
              <Route path="/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/profile/billing" element={<Billing />} />
              <Route path="/directions" element={<Directions />} />
              <Route path="/support" element={<SupportAccessRoute><Support /></SupportAccessRoute>} />
              <Route path="/inbox" element={<ProtectedRoute><Inbox /></ProtectedRoute>} />
              <Route path="/challenges" element={<ProtectedRoute><Challenges /></ProtectedRoute>} />
              <Route path="/invite-homie" element={<ProtectedRoute><InviteHomie /></ProtectedRoute>} />
              <Route path="/login" element={<LoginEntryRoute mode="user"><Login /></LoginEntryRoute>} />
              <Route path="/register" element={<Suspense fallback={<div className="container pageStack"><div className="card pageCardShell">Loading…</div></div>}><Register /></Suspense>} />
              <Route path="/verify-contact" element={<VerifyContact />} />
              <Route path="/request-password-reset" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/my-golf-scores" element={<ProtectedRoute><MyGolfScores /></ProtectedRoute>} />
              <Route path="/my-tournaments" element={<ProtectedRoute><MyTournaments /></ProtectedRoute>} />
              <Route path="/find-tournament" element={<ProtectedRoute><FindTournament /></ProtectedRoute>} />
              <Route path="/find-course" element={<ProtectedRoute><FindCourse /></ProtectedRoute>} />
              <Route path="/host/register" element={<CreateHostAccount />} />
              <Route path="/host/login" element={<LoginEntryRoute mode="host"><HostLogin /></LoginEntryRoute>} />
              <Route path="/host/request-password-reset" element={<HostForgotPassword />} />
              <Route path="/host/reset-password" element={<HostResetPassword />} />
              <Route path="/host/portal" element={<HostProtectedRoute><HostPortal /></HostProtectedRoute>} />
              <Route path="/host/portal/profile" element={<HostProtectedRoute><HostProfile /></HostProtectedRoute>} />
              <Route path="/organizer/register" element={<LoginEntryRoute mode="organizer"><Suspense fallback={<div className="container pageStack"><div className="card pageCardShell">Loading…</div></div>}><OrganizerRegister /></Suspense></LoginEntryRoute>} />
              <Route path="/organizer/login" element={<LoginEntryRoute mode="organizer"><OrganizerLogin /></LoginEntryRoute>} />
              <Route path="/organizer/forgot-password" element={<OrganizerForgotPassword />} />
              <Route path="/organizer/reset-password" element={<OrganizerResetPassword />} />
              <Route path="/organizer/portal" element={<OrganizerProtectedRoute><OrganizerTournaments /></OrganizerProtectedRoute>} />
              <Route path="/organizer/portal/profile" element={<OrganizerProtectedRoute><OrganizerProfile /></OrganizerProtectedRoute>} />
              <Route path="/tournaments/:id/leaderboard" element={<TournamentLeaderboard />} />
              <Route path="/tournaments/:id/pictures" element={<TournamentPictures />} />
              <Route path="/tournaments/:id" element={<TournamentPortal />} />
              <Route path="/golfadmin" element={<AdminEntryRoute><AdminPortal /></AdminEntryRoute>} />
              <Route path="/golfadmin/forgot-password" element={<AdminResetPassword />} />
              <Route path="/golfadmin/reset-password" element={<AdminResetPassword />} />
              <Route path="/golfadmin/scheduled-jobs" element={<AdminEntryRoute><AdminScheduledJobs /></AdminEntryRoute>} />
              <Route path="/golfadmin/access-codes" element={<AdminEntryRoute><AdminAccessCodes /></AdminEntryRoute>} />
              <Route path="/:golfCourseSlug/calendar" element={<GolfCourseCalendarPage />} />
              <Route path="/:golfCourseSlug" element={<GolfCoursePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </HostAuthProvider>
        </OrganizerAuthProvider>
      </AdminAuthProvider>
    </AuthProvider>
  )
}
