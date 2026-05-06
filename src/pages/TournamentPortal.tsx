import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useAuth } from '../context/AuthContext'
import { fetchTournamentPortal, registerForTournament, type TournamentPortal as TournamentPortalData } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function TournamentPortal() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [portal, setPortal] = useState<TournamentPortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await fetchTournamentPortal(id)
        if (!active) return
        setPortal(result)
        setRegistered(Boolean(result.isViewerRegistered))
        logFrontendEvent({ category: 'tournament.portal', message: 'portal_loaded', data: { tournamentId: id, registrationCount: result.registrationCount, isViewerRegistered: Boolean(result.isViewerRegistered) } })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load tournament portal.'
        if (active) setError(message)
        logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'portal_load_failed', data: { tournamentId: id, error: message } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [id])

  const registrationClosed = useMemo(() => {
    const status = portal?.tournament.status
    return status === 'cancelled' || status === 'completed'
  }, [portal?.tournament.status])

  async function onRegister() {
    if (!id) return
    if (!user && !authLoading) {
      const returnTo = `/tournaments/${encodeURIComponent(id)}`
      logFrontendEvent({ category: 'tournament.portal', message: 'registration_requires_account', data: { tournamentId: id, returnTo } })
      navigate(`/register?returnTo=${encodeURIComponent(returnTo)}`)
      return
    }

    setRegistering(true)
    setError(null)
    try {
      const result = await registerForTournament(id)
      setRegistered(true)
      setPortal((current) => current ? { ...current, isViewerRegistered: true, viewerRegistration: result.registration || current.viewerRegistration || null } : current)
      logFrontendEvent({ category: 'tournament.portal', message: 'registration_completed', data: { tournamentId: id, alreadyRegistered: Boolean(result.alreadyRegistered) } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not register for tournament.'
      setError(message)
      if (/Unauthorized|Authentication/i.test(message)) navigate(`/register?returnTo=${encodeURIComponent(`/tournaments/${id}`)}`)
      logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'registration_failed', data: { tournamentId: id, error: message } })
    } finally {
      setRegistering(false)
    }
  }

  if (loading) return <div className="container"><div className="card">Loading tournament portal…</div></div>
  const tournament = portal?.tournament

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Tournament portal" title={tournament?.name || 'Tournament not found'} subtitle="Tournament details and Golf Homiez account registration." />
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {tournament ? (
          <div className="formStack" style={{ maxWidth: 760 }}>
            <div className="card" style={{ padding: 16 }}>
              <div><strong>Dates:</strong> {tournament.startDate}{tournament.endDate ? ` to ${tournament.endDate}` : ''}</div>
              <div><strong>Status:</strong> {tournament.status}</div>
              <div><strong>Organizer:</strong> {tournament.organizerName || 'Golf Homiez organizer'}</div>
              <div><strong>Host:</strong> {tournament.hostGolfCourseName || 'Host to be announced'}</div>
              <div><strong>Registered golfers:</strong> {portal?.registrationCount ?? 0}</div>
            </div>
            {tournament.description ? <p>{tournament.description}</p> : null}
            <div className="card" style={{ padding: 16 }}>
              <strong>Registration</strong>
              <p className="small">Only golfers signed in with a Golf Homiez user account can register. New golfers are sent through the Golf Homiez registration flow first.</p>
              {registered ? (
                <div className="small" style={{ color: '#166534', fontWeight: 700 }}>You are already registered for this tournament.</div>
              ) : (
                <button className="btn btnPrimary" type="button" disabled={registering || registrationClosed || authLoading} onClick={onRegister}>
                  {registering ? 'Registering…' : user ? 'Register for tournament' : 'Create account to register'}
                </button>
              )}
            </div>
          </div>
        ) : <Link className="btn" to="/">Go home</Link>}
      </div>
    </div>
  )
}
