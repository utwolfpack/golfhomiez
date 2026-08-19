import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { useAdminAuth } from '../context/AdminAuthContext'
import { useAuth } from '../context/AuthContext'
import { useHostAuth } from '../context/HostAuthContext'
import { useOrganizerAuth } from '../context/OrganizerAuthContext'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import brandEmblem from '../assets/GolfHomiezEmblem.png'

type NavIconProps = { className?: string }

function ChallengesIcon({ className = '' }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 4.5 17 19.5M17 4.5 7 19.5" />
      <circle cx="6.2" cy="3.8" r="1.8" />
      <circle cx="17.8" cy="3.8" r="1.8" />
      <path d="M4.5 20.5h5M14.5 20.5h5" />
    </svg>
  )
}

function AddScoreIcon({ className = '' }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="3.5" width="12.5" height="17" rx="2.2" />
      <path d="M7.5 8h5.5M7.5 12h4M7.5 16h3" />
      <circle cx="17.5" cy="16.5" r="4" />
      <path d="M17.5 14.4v4.2M15.4 16.5h4.2" />
    </svg>
  )
}

function TournamentTrophyIcon({ className = '' }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 4h8v4.2a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H4.8v1.2A3.8 3.8 0 0 0 8.6 11M16 6h3.2v1.2a3.8 3.8 0 0 1-3.8 3.8" />
      <path d="M12 12.2V17M8.5 20h7M9.5 17h5v3h-5z" />
    </svg>
  )
}

function GolfHomiezUserIcon({ className = '' }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M8.3 9.2c.7-2.7 2.1-4 4.2-4 1.7 0 3.1.8 4.1 2.5-2.4-.3-5.2.2-8.3 1.5Z" />
      <path d="M9.2 9.5a3.1 3.1 0 1 0 5.8 1.5 3 3 0 0 0-.4-1.5" />
      <path d="M6.8 18.7c.9-2.7 2.7-4.1 5.2-4.1s4.3 1.4 5.2 4.1" />
      <circle cx="17.8" cy="15.3" r=".55" className="navIconDimple" />
    </svg>
  )
}

const mobileGolferLinks = [
  { to: '/challenges', label: 'Challenges', event: 'mobile_challenges_selected', Icon: ChallengesIcon },
  { to: '/my-golf-scores', label: 'My Scores', event: 'mobile_add_score_selected', Icon: AddScoreIcon },
  { to: '/my-tournaments', label: 'My Tournaments', event: 'mobile_tournaments_selected', Icon: TournamentTrophyIcon },
]

export default function NavBar() {
  const { user, logout, roles } = useAuth()
  const { adminUser, logoutAdmin } = useAdminAuth()
  const { hostAccount, logoutHost } = useHostAuth()
  const { organizerAccount, logoutOrganizer } = useOrganizerAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const restrictedRole = adminUser
    ? 'admin'
    : hostAccount
      ? 'host'
      : organizerAccount
        ? 'organizer'
        : null

  const restrictedSession = Boolean(restrictedRole)
  const menuLabel = adminUser?.email || hostAccount?.email || organizerAccount?.email || user?.email || 'Account'
  const navHomePath = adminUser ? '/golfadmin' : hostAccount ? '/host/portal' : (organizerAccount || roles.includes('organizer')) ? '/organizer/portal' : '/'
  const navHomeLabel = adminUser ? 'admin home' : hostAccount ? 'host portal home' : (organizerAccount || roles.includes('organizer')) ? 'organizer portal home' : 'Golf Homiez home'
  const navBrandCorrelationId = getCorrelationId()
  const showMobileGolferLinks = Boolean(user && !restrictedSession)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function logMobileNavigation(message: string, destination: string) {
    logFrontendEvent({
      category: 'app.nav.mobile',
      message,
      data: { destination, correlationId: getCorrelationId() },
    })
  }

  function handleGuestNavigation(destination: string, accountType: 'user' | 'host' | 'organizer' | 'registration') {
    setOpen(false)
    logFrontendEvent({
      category: 'app.nav.guest',
      message: 'guest_navigation_selected',
      data: { destination, accountType, correlationId: getCorrelationId() },
    })
  }

  async function handleLogout() {
    setOpen(false)
    try {
      if (adminUser) {
        await logoutAdmin()
        navigate('/golfadmin', { replace: true })
        return
      }
      if (hostAccount) {
        await logoutHost()
        navigate('/host/login', { replace: true })
        return
      }
      if (organizerAccount) {
        await logoutOrganizer()
        navigate('/organizer/login', { replace: true })
        return
      }
      if (user) {
        await logout()
      }
      navigate('/login', { replace: true })
    } catch {
      if (adminUser) return navigate('/golfadmin', { replace: true })
      if (hostAccount) return navigate('/host/login', { replace: true })
      if (organizerAccount) return navigate('/organizer/login', { replace: true })
      navigate('/login', { replace: true })
    }
  }

  return (
    <>
      <div className="nav">
        <Link to={navHomePath} className="navBrand navBrand--image" aria-label={`Go to ${navHomeLabel}`}>
          <img
            src={brandEmblem}
            alt="Golf Homiez"
            className="navBrandImg"
            data-correlation-id={navBrandCorrelationId}
            onLoad={() => logFrontendEvent({ category: 'app.nav', message: 'nav_brand_emblem_loaded', data: { navHomePath, correlationId: navBrandCorrelationId } })}
            onError={() => logFrontendEvent({ category: 'app.nav', level: 'error', message: 'nav_brand_emblem_load_failed', data: { navHomePath, correlationId: navBrandCorrelationId } })}
          />
        </Link>

        <div className="navActions">
          {showMobileGolferLinks ? (
            <nav className="navMobileQuickLinks" aria-label="Golfer shortcuts">
              {mobileGolferLinks.map(({ to, label, event, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `navMobileQuickLink${isActive ? ' active' : ''}`}
                  aria-label={label}
                  title={label}
                  onClick={() => logMobileNavigation(event, to)}
                >
                  <Icon className="navMobileQuickLinkIcon" />
                  <span className="visuallyHidden">{label}</span>
                </NavLink>
              ))}
            </nav>
          ) : null}

          <div className="navMenuWrap" ref={menuRef}>
            {!user && !hostAccount && !adminUser && !organizerAccount ? (
              <>
                <button
                  type="button"
                  className="navMenuTrigger"
                  aria-label="Open login and registration menu"
                  aria-expanded={open}
                  aria-controls="app-guest-menu"
                  onClick={() => {
                    const nextOpen = !open
                    setOpen(nextOpen)
                    logFrontendEvent({ category: 'app.nav.guest', message: 'guest_menu_toggled', data: { open: nextOpen, correlationId: getCorrelationId() } })
                  }}
                >
                  <span className="navMenuLabel">Login/Register</span>
                  <span className={`navMenuCaret ${open ? 'navMenuCaretOpen' : ''}`} aria-hidden="true">▾</span>
                </button>
                {open ? (
                  <div className="navDropdown" id="app-guest-menu">
                    <NavLink className="navDropdownItem" to="/login" onClick={() => handleGuestNavigation('/login', 'user')}>User Login</NavLink>
                    <NavLink className="navDropdownItem" to="/register" onClick={() => handleGuestNavigation('/register', 'registration')}>Create account</NavLink>
                    <NavLink className="navDropdownItem" to="/host/login" onClick={() => handleGuestNavigation('/host/login', 'host')}>Host Login</NavLink>
                    <NavLink className="navDropdownItem" to="/organizer/login" onClick={() => handleGuestNavigation('/organizer/login', 'organizer')}>Organizer Login</NavLink>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="navMenuTrigger navMenuTrigger--account"
                  aria-label="Open account menu"
                  aria-expanded={open}
                  aria-controls="app-account-menu"
                  onClick={() => {
                    const nextOpen = !open
                    setOpen(nextOpen)
                    logFrontendEvent({ category: 'app.nav', message: 'account_menu_toggled', data: { open: nextOpen, restrictedRole, correlationId: getCorrelationId() } })
                  }}
                >
                  <GolfHomiezUserIcon className="navMenuAccountIcon" />
                  <span className="navMenuLabel">{menuLabel}</span>
                  <span className={`navMenuCaret ${open ? 'navMenuCaretOpen' : ''}`} aria-hidden="true">▾</span>
                </button>
                {open ? (
                  <div className="navDropdown" id="app-account-menu">
                    {adminUser ? (
                      <>
                        <NavLink className="navDropdownItem" to="/golfadmin" onClick={() => setOpen(false)}>Admin portal</NavLink>
                        <NavLink className="navDropdownItem" to="/golfadmin/scheduled-jobs" onClick={() => setOpen(false)}>Scheduled jobs</NavLink>
                      </>
                    ) : null}
                    {hostAccount ? (
                      <>
                        <NavLink className="navDropdownItem" to="/host/portal" onClick={() => setOpen(false)}>Host portal</NavLink>
                        <NavLink className="navDropdownItem" to="/host/portal/profile" onClick={() => setOpen(false)}>Host profile</NavLink>
                      </>
                    ) : null}
                    {organizerAccount ? (
                      <>
                        <NavLink className="navDropdownItem" to="/organizer/portal" onClick={() => setOpen(false)}>Organizer portal</NavLink>
                        <NavLink className="navDropdownItem" to="/organizer/portal/profile" onClick={() => setOpen(false)}>Organizer profile</NavLink>
                      </>
                    ) : null}
                    {restrictedSession ? null : (
                      <>
                        <NavLink className="navDropdownItem" to="/my-golf-scores" onClick={() => { setOpen(false); logFrontendEvent({ category: 'app.nav.golfer', message: 'my_scores_selected', data: { destination: '/my-golf-scores', correlationId: getCorrelationId() } }) }}>My Scores</NavLink>
                        <NavLink className="navDropdownItem" to="/my-tournaments" onClick={() => { setOpen(false); logFrontendEvent({ category: 'app.nav.golfer', message: 'my_tournaments_selected', data: { destination: '/my-tournaments', correlationId: getCorrelationId() } }) }}>My Tournaments</NavLink>
                        <NavLink className="navDropdownItem" to="/challenges" onClick={() => { setOpen(false); logFrontendEvent({ category: 'app.nav.golfer', message: 'challenges_selected', data: { destination: '/challenges', correlationId: getCorrelationId() } }) }}>Challenges</NavLink>
                        <NavLink className="navDropdownItem" to="/find-tournament" onClick={() => { setOpen(false); logFrontendEvent({ category: 'app.nav.golfer', message: 'find_tournament_selected', data: { destination: '/find-tournament', correlationId: getCorrelationId() } }) }}>Find a Tournament</NavLink>
                        <NavLink className="navDropdownItem" to="/find-course" onClick={() => { setOpen(false); logFrontendEvent({ category: 'app.nav.golfer', message: 'find_golf_course_selected', data: { destination: '/find-course', correlationId: getCorrelationId() } }) }}>Find a Golf Course</NavLink>
                        <NavLink className="navDropdownItem" to="/profile" onClick={() => { setOpen(false); logFrontendEvent({ category: 'app.nav.golfer', message: 'profile_selected', data: { destination: '/profile', correlationId: getCorrelationId() } }) }}>Profile</NavLink>
                      </>
                    )}
                    <button type="button" className="navDropdownItem" onClick={() => void handleLogout()}>Logout</button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
