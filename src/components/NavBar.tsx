import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { useAuth } from '../context/AuthContext'
import { useHostAuth } from '../context/HostAuthContext'
import { useOrganizerAuth } from '../context/OrganizerAuthContext'
import InviteHomieModal from './InviteHomieModal'
import { sendHomieInvite } from '../lib/teams'

export default function NavBar() {
  const { user, logout } = useAuth()
  const { adminUser, logoutAdmin } = useAdminAuth()
  const { hostAccount, logoutHost } = useHostAuth()
  const { organizerAccount, logoutOrganizer } = useOrganizerAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
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

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

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
        <Link to="/" className="navBrand">⛳ Golf Homiez!</Link>
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
                  {restrictedSession ? null : (
                    <>
                      <NavLink className="navDropdownItem" to="/" onClick={() => setOpen(false)}>Home</NavLink>
                      <NavLink className="navDropdownItem" to="/my-golf-scores" onClick={() => setOpen(false)}>My Golf Scores</NavLink>
                      <NavLink className="navDropdownItem" to="/my-tournaments" onClick={() => setOpen(false)}>My Tournaments</NavLink>
                      <NavLink className="navDropdownItem" to="/teams" onClick={() => setOpen(false)}>Teams</NavLink>
                      <NavLink className="navDropdownItem" to="/profile" onClick={() => setOpen(false)}>Profile</NavLink>
                      <NavLink className="navDropdownItem" to="/directions" onClick={() => setOpen(false)}>Directions</NavLink>
                      <button type="button" className="navDropdownItem" onClick={() => { setOpen(false); setShowInvite(true) }}>Invite Homie</button>
                    </>
                  )}
                  <button type="button" className="navDropdownItem" onClick={() => void handleLogout()}>Logout</button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <InviteHomieModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onSubmit={async ({ email, message }) => {
          await sendHomieInvite(email, message)
        }}
      />
    </>
  )
}
