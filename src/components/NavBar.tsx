import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import InviteHomieModal from './InviteHomieModal'
import { sendHomieInvite } from '../lib/teams'

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <>
      <div className="nav">
        <Link to="/" className="navBrand">⛳ Golf Homiez!</Link>
        <div className="navMenuWrap" ref={menuRef}>
          {!user ? (
            <NavLink to="/login" className="navMenuTrigger">Login/Register</NavLink>
          ) : (
            <>
              <button type="button" className="navMenuTrigger" onClick={() => setOpen(v => !v)}>
                <span className="navMenuLabel">{user.email}</span>
                <span className={`navMenuCaret ${open ? 'navMenuCaretOpen' : ''}`}>▾</span>
              </button>
              {open ? (
                <div className="navDropdown">
                  <NavLink className="navDropdownItem" to="/" onClick={() => setOpen(false)}>Home</NavLink>
                  <NavLink className="navDropdownItem" to="/my-golf-scores" onClick={() => setOpen(false)}>My Golf Scores</NavLink>
                  <NavLink className="navDropdownItem" to="/teams" onClick={() => setOpen(false)}>Teams</NavLink>
                  <NavLink className="navDropdownItem" to="/directions" onClick={() => setOpen(false)}>Directions</NavLink>
                  <button type="button" className="navDropdownItem" onClick={() => { setOpen(false); setShowInvite(true) }}>Invite Homie</button>
                  <button type="button" className="navDropdownItem" onClick={() => { setOpen(false); logout(); navigate('/login') }}>Logout</button>
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
