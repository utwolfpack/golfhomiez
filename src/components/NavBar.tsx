import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { useAuth } from '../context/AuthContext'
import { useHostAuth } from '../context/HostAuthContext'
import { useOrganizerAuth } from '../context/OrganizerAuthContext'
import { fetchInboxSummary } from '../lib/inbox'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import brandEmblem from '../assets/GolfHomiezEmblem.png'

export default function NavBar() {
  const { user, logout, roles } = useAuth()
  const { adminUser, logoutAdmin } = useAdminAuth()
  const { hostAccount, logoutHost } = useHostAuth()
  const { organizerAccount, logoutOrganizer } = useOrganizerAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0)
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

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (!user || restrictedSession) {
      setInboxUnreadCount(0)
      return
    }

    let active = true
    async function loadInboxIndicator() {
      try {
        const summary = await fetchInboxSummary()
        if (active) setInboxUnreadCount(Number(summary.unreadCount || 0))
        logFrontendEvent({ category: 'app.nav', message: 'inbox_indicator_loaded', data: { unreadCount: summary.unreadCount || 0 } })
      } catch (error) {
        if (active) setInboxUnreadCount(0)
        logFrontendEvent({ category: 'app.nav', level: 'warn', message: 'inbox_indicator_load_failed', data: { error: error instanceof Error ? error.message : String(error) } })
      }
    }

    void loadInboxIndicator()
    const timer = globalThis.setInterval(() => void loadInboxIndicator(), 30000)
    return () => {
      active = false
      globalThis.clearInterval(timer)
    }
  }, [user?.id, restrictedSession])

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
        <div className="navMenuWrap" ref={menuRef}>
          {!user && !hostAccount && !adminUser && !organizerAccount ? (
            <NavLink to="/login" className="navMenuTrigger">Login/Register</NavLink>
          ) : (
            <>
              <button type="button" className="navMenuTrigger" onClick={() => setOpen((v) => !v)}>
                <span className="navMenuLabel">{menuLabel}</span>
                <span className={`navMenuCaret ${open ? 'navMenuCaretOpen' : ''}`}>▾</span>
              </button>
              {open ? (
                <div className="navDropdown">
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
                      <NavLink className="navDropdownItem" to="/support" onClick={() => setOpen(false)}>Support</NavLink>
                    </>
                  ) : null}
                  {organizerAccount ? (
                    <>
                      <NavLink className="navDropdownItem" to="/organizer/portal" onClick={() => setOpen(false)}>Organizer portal</NavLink>
                      <NavLink className="navDropdownItem" to="/organizer/portal/profile" onClick={() => setOpen(false)}>Organizer profile</NavLink>
                      <NavLink className="navDropdownItem" to="/support" onClick={() => setOpen(false)}>Support</NavLink>
                    </>
                  ) : null}
                  {restrictedSession ? null : (
                    <>
                      <NavLink className="navDropdownItem" to="/" onClick={() => setOpen(false)}>Home</NavLink>
                      <NavLink className="navDropdownItem navDropdownItem--withIndicator" to="/inbox" onClick={() => setOpen(false)}>
                        <span>Challenges &amp; Messages</span>
                        {inboxUnreadCount > 0 ? <span className="inboxNavIndicator" aria-label={`${inboxUnreadCount} unread inbox messages`}>{inboxUnreadCount}</span> : null}
                      </NavLink>
                      <NavLink className="navDropdownItem" to="/my-golf-scores" onClick={() => setOpen(false)}>My Scores</NavLink>
                      <NavLink className="navDropdownItem" to="/my-tournaments" onClick={() => setOpen(false)}>My Tournaments</NavLink>
                      <NavLink className="navDropdownItem" to="/teams" onClick={() => setOpen(false)}>Teams</NavLink>
                      <NavLink className="navDropdownItem" to="/profile" onClick={() => setOpen(false)}>Profile</NavLink>
                      <NavLink className="navDropdownItem" to="/directions" onClick={() => setOpen(false)}>Directions</NavLink>
                      <NavLink className="navDropdownItem" to="/support" onClick={() => setOpen(false)}>Support</NavLink>
                      <NavLink className="navDropdownItem" to="/invite-homie" onClick={() => setOpen(false)}>Invite Homie</NavLink>
                    </>
                  )}
                  <button type="button" className="navDropdownItem" onClick={() => void handleLogout()}>Logout</button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  )
}
