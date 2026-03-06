import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function A({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        padding: '8px 10px',
        borderRadius: 10,
        border: isActive ? '1px solid rgba(255,255,255,.28)' : '1px solid transparent',
        background: isActive ? 'rgba(255,255,255,.18)' : 'transparent'
      })}
    >
      {children}
    </NavLink>
  )
}

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="nav">
      <Link to="/" style={{ fontWeight: 700 }}>⛳ Golf Homiez!</Link>
      <div className="navLinks">
        <A to="/">Home</A>
        {user ? (
          <>
            <A to="/teams">Teams</A>
            <A to="/my-golf-scores">My Golf Scores</A>
          </>
        ) : null}
        <A to="/directions">Directions</A>
        {!user ? (
          <A to="/login">Login/Register</A>
        ) : (
          <>
            <span className="small">Signed in as <strong>{user.email}</strong></span>
            <button className="btn" onClick={() => { logout(); navigate('/login') }}>Logout</button>
          </>
        )}
      </div>
    </div>
  )
}
