import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchMyTeams, fetchTournamentPortal, registerForTournament, type TournamentPortal as TournamentPortalData } from '../lib/accounts'
import type { Team } from '../types'
import { formatFriendlyDateTime } from '../lib/time-format'
import { getTournamentTemplate, emptyTournamentTemplateData, type TournamentTemplateData, type TournamentAttributeIconKey } from '../lib/tournament-templates'
import { logFrontendEvent } from '../lib/frontend-logger'


function lines(value?: string | null) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function FlyerList({ title, items, icon, accent = '#0f3f24' }: { title: string; items: string[]; icon?: string; accent?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {icon ? <span style={{ display: 'inline-flex', width: 34, height: 34, borderRadius: '50%', background: accent, alignItems: 'center', justifyContent: 'center' }}><img src={icon} alt="" aria-hidden="true" style={{ width: 22, height: 22, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} /></span> : null}
        <h3 style={{ color: accent, margin: 0, fontSize: 16, textTransform: 'uppercase' }}>{title}</h3>
      </div>
      {items.length ? <ul style={{ marginTop: 0 }}>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="small">Details coming soon.</p>}
    </div>
  )
}

const ATTRIBUTE_ROWS: Array<{ key: TournamentAttributeIconKey; label: string; value: (tournament: NonNullable<TournamentPortalData['tournament']>, templateData: TournamentTemplateData) => string }> = [
  { key: 'date', label: 'Date', value: (tournament) => tournament.startDate ? formatFriendlyDateTime(tournament.startDate || '') : 'To be announced' },
  { key: 'teeTime', label: 'Tee time / Check-in', value: (_tournament, templateData) => templateData.checkInTime || 'To be announced' },
  { key: 'course', label: 'Course / Venue', value: (tournament) => tournament.hostGolfCourseName || 'To be announced' },
  { key: 'location', label: 'Location', value: (tournament) => tournament.hostGolfCourseAddress || tournament.hostGolfCourseName || 'To be announced' },
  { key: 'format', label: 'Format', value: (_tournament, templateData) => templateData.tournamentFormat || 'To be announced' },
  { key: 'registrationFee', label: 'Registration Fee', value: (_tournament, templateData) => templateData.entryFee || 'To be announced' },
]

function TournamentFlyer({ tournament, templateData, attributeIcons, accentColor }: { tournament: NonNullable<TournamentPortalData['tournament']>; templateData: TournamentTemplateData; attributeIcons: Record<TournamentAttributeIconKey, string>; accentColor: string }) {
  const title = templateData.tournamentName || tournament.name
  const host = templateData.hostOrganization || tournament.organizerName || 'Host organization'
  const logos = Array.isArray(templateData.logoFiles) ? templateData.logoFiles.slice(0, 18) : []
  const feeValue = templateData.entryFee ? (String(templateData.entryFee).trim().startsWith('$') ? templateData.entryFee : `$${templateData.entryFee}`) : 'To be announced'
  const rows = ATTRIBUTE_ROWS.map((row) => ({ ...row, displayValue: row.key === 'registrationFee' ? feeValue : row.value(tournament, templateData) }))
  const backgroundImageUrl = tournament.templateBackgroundImageUrl || ''
  const description = String(tournament.description || '').trim()
  const flyerPageUrl = tournament.portalUrl || (typeof window !== 'undefined' ? window.location.href : tournament.portalPath || '')

  return (
    <section className="card tournament-flyer" aria-label="Tournament flyer" style={{ overflow: 'hidden', padding: 0, border: '1px solid #b7d7ad', background: '#fff' }}>
      <div className="tournament-flyer-print-content">
      <div className="tournament-flyer-header" style={{ maxWidth: 920, margin: '0 auto', padding: '28px 20px 18px', textAlign: 'center' }}>
        <div style={{ color: '#c6922e', fontSize: 36, lineHeight: 1 }}>♕</div>
        <div style={{ color: accentColor, fontSize: 'clamp(36px, 7vw, 74px)', lineHeight: .95, fontWeight: 900, letterSpacing: '.02em', textTransform: 'uppercase' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'center', marginTop: 12, color: accentColor, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          <span style={{ flex: '0 1 170px', height: 2, background: '#c6922e' }} />
          <span>Presented by / {host}</span>
          <span style={{ flex: '0 1 170px', height: 2, background: '#c6922e' }} />
        </div>
        {backgroundImageUrl ? <div className="tournament-flyer-banner" aria-label="Tournament flyer background banner" style={{ margin: '18px auto 0', maxWidth: 840, height: 170, borderRadius: 16, overflow: 'hidden', border: '1px solid #b7d7ad' }}><img src={backgroundImageUrl} alt="Tournament flyer banner" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.82 }} /></div> : null}
        {description ? <p style={{ maxWidth: 780, margin: '16px auto 0', color: '#374151', fontSize: 18, lineHeight: 1.45 }}>{description}</p> : null}
      </div>

      <div className="tournament-flyer-attributes" aria-label="Tournament flyer attribute rows" style={{ maxWidth: 920, margin: '0 auto', padding: '0 20px' }}>
        {rows.map((row) => (
          <div className="tournament-flyer-attribute-row" key={row.key} style={{ display: 'grid', gridTemplateColumns: '96px 28px minmax(145px, 260px) 1fr', alignItems: 'center', gap: 16, borderTop: '1px solid #b7d7ad', minHeight: 88, padding: '10px 0' }}>
            <img src={attributeIcons[row.key]} alt="" aria-hidden="true" style={{ width: 72, height: 72, objectFit: 'contain', justifySelf: 'center' }} />
            <div style={{ width: 2, alignSelf: 'stretch', background: '#b7d7ad' }} />
            <div style={{ color: accentColor, fontWeight: 900, fontSize: 20, textTransform: 'uppercase', lineHeight: 1.1 }}>{row.label}</div>
            <div style={{ color: '#111827', fontSize: 18, lineHeight: 1.25 }}>{row.displayValue}</div>
          </div>
        ))}
      </div>

      <div className="tournament-flyer-body" style={{ maxWidth: 920, margin: '0 auto', padding: '0 20px 24px' }}>
        <div className="grid grid3" style={{ gap: 20, borderTop: '1px solid #b7d7ad', paddingTop: 18 }}>
          <FlyerList title="What’s Included" items={lines(templateData.feesInclude)} accent={accentColor} />
          <FlyerList title="Prizes / Awards" items={lines(templateData.prizeDetails)} icon={attributeIcons.format} accent={accentColor} />
          <FlyerList title="Contest Holes / Extras" items={lines(templateData.holeContestsExtras)} icon={attributeIcons.location} accent={accentColor} />
        </div>
        {templateData.miscNotes ? <div className="card" style={{ marginTop: 18, padding: 12, background: '#f7fbf5', borderColor: '#b7d7ad' }}><strong style={{ color: accentColor }}>Tournament Information:</strong> {templateData.miscNotes}</div> : null}
        <div style={{ margin: '20px auto 0', maxWidth: 640, display: 'grid', gridTemplateColumns: '1fr 220px', border: `2px solid ${accentColor}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ background: accentColor, color: '#fff', padding: 16, fontWeight: 900, fontSize: 28, textTransform: 'uppercase' }}>Register Now<div style={{ fontSize: 13, fontWeight: 700, textTransform: 'none', overflowWrap: 'anywhere' }}><a href={flyerPageUrl || undefined} style={{ color: '#fff', textDecoration: 'underline' }}>{flyerPageUrl}</a></div></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentColor, fontWeight: 800 }}>QR CODE</div>
        </div>
        <div className="card" style={{ marginTop: 20, padding: 18, background: '#f7fbf5', borderColor: '#b7d7ad' }}>
          <div className="grid grid2" style={{ gap: 16 }}>
            <div><strong style={{ color: accentColor }}>Contact</strong><div>{templateData.contactPerson || 'Contact person'}</div><div>{templateData.contactPhone || 'Phone'}</div><div>{templateData.contactEmail || 'Email'}</div></div>
            <div><strong style={{ color: accentColor }}>Beneficiary / Charity</strong><div>{templateData.beneficiaryCharity || 'Proceeds benefit'}</div></div>
          </div>
        </div>
        <h3 style={{ textAlign: 'center', color: accentColor, textTransform: 'uppercase' }}>Sponsors</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
          {logos.length ? logos.map((logo, index) => <div key={`${logo.slice(0, 24)}-${index}`} className="card" style={{ padding: 8 }}><img src={logo} alt={`Sponsor logo ${index + 1}`} style={{ width: '100%', height: 60, objectFit: 'contain' }} /></div>) : Array.from({ length: 6 }).map((_, index) => <div key={index} className="card small" style={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', borderStyle: 'dashed' }}>Your logo here</div>)}
        </div>
      </div>
      </div>
    </section>
  )
}

export default function TournamentPortal() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [portal, setPortal] = useState<TournamentPortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [teamMode, setTeamMode] = useState<'existing' | 'new'>('existing')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamMembers, setNewTeamMembers] = useState<Array<{ id: string; name: string; email: string }>>([])

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

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const result = await fetchMyTeams()
        if (!active) return
        setTeams(result.filter((team) => [2, 4].includes(team.members?.length || 0)))
        if (result[0]?.id) setSelectedTeamId(result[0].id)
      } catch (err) {
        logFrontendEvent({ category: 'tournament.portal', level: 'warn', message: 'team_options_load_failed', data: { tournamentId: id, error: err instanceof Error ? err.message : String(err) } })
      }
    })()
    return () => { active = false }
  }, [id, user])

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
      const payload = teamMode === 'existing'
        ? { teamId: selectedTeamId }
        : { teamName: newTeamName, teamMembers: newTeamMembers }
      const result = await registerForTournament(id, payload)
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
  const template = getTournamentTemplate(tournament?.templateKey)
  const templateData = { ...emptyTournamentTemplateData(), ...(tournament?.templateData || {}) }
  const attributeIcons = template.attributeIcons

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {tournament ? <button type="button" className="btn btnPrimary" onClick={() => window.print()}>Print flyer</button> : null}
          <Link className="btn" to="/my-tournaments" aria-label="Close tournament portal and return to my tournaments">Close</Link>
        </div>
        <style>{`@media print { @page { size: letter portrait; margin: 0.15in; } html, body { width: 8.2in !important; height: 10.7in !important; overflow: hidden !important; } body * { visibility: hidden !important; } .tournament-flyer, .tournament-flyer * { visibility: visible !important; } .tournament-flyer { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: 8.2in !important; max-height: 10.7in !important; overflow: hidden !important; box-shadow: none !important; border-width: 1px !important; break-after: avoid !important; page-break-after: avoid !important; } .tournament-flyer-print-content { transform: scale(0.58) !important; transform-origin: top center !important; width: 172.41% !important; margin-left: -36.205% !important; } .tournament-flyer-header { padding-top: 8px !important; padding-bottom: 6px !important; } .tournament-flyer-header h1 { font-size: 36px !important; margin-bottom: 6px !important; } .tournament-flyer-header p { margin: 4px 0 !important; } .tournament-flyer-banner { height: 86px !important; margin-top: 6px !important; } .tournament-flyer-attribute-row { min-height: 46px !important; padding-top: 2px !important; padding-bottom: 2px !important; gap: 10px !important; } .tournament-flyer-attribute-row img { width: 34px !important; height: 34px !important; } .tournament-flyer-body { padding-bottom: 6px !important; } .tournament-flyer-body h2, .tournament-flyer-body h3 { margin: 8px 0 6px !important; } .tournament-flyer-body .card { padding: 8px !important; } .tournament-flyer-body img { max-height: 44px !important; } .tournament-flyer .card { box-shadow: none !important; } .no-print { display: none !important; } }`}</style>
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {tournament ? (
          <>
            <TournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={template.accentColor} />
            <div className="formStack" style={{ maxWidth: 760 }}>
            <div className="card" style={{ padding: 16 }}>
              <div><strong>Date:</strong> {tournament.startDate ? formatFriendlyDateTime(tournament.startDate) : 'Date to be announced'}</div>
              <div><strong>Status:</strong> {tournament.status}</div>
              <div><strong>Organizer:</strong> {tournament.organizerName || 'Golf Homiez organizer'}</div>
              <div><strong>Host:</strong> {tournament.hostGolfCourseName || 'Host to be announced'}</div>
              <div><strong>Registered golfers:</strong> {portal?.registrationCount ?? 0}</div>
              <div><strong>Registered teams:</strong> {portal?.registrations?.filter((registration) => registration.teamName).length ?? 0}</div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <strong>Registration</strong>
              <p className="small">Only golfers signed in with a Golf Homiez user account can register. Select one of your existing two-person or four-person teams, or create a new tournament team.</p>
              {!registered && user ? (
                <div className="formStack" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <label><input type="radio" checked={teamMode === 'existing'} onChange={() => setTeamMode('existing')} /> Existing team</label>
                    <label><input type="radio" checked={teamMode === 'new'} onChange={() => setTeamMode('new')} /> New team</label>
                  </div>
                  {teamMode === 'existing' ? (
                    <div>
                      <label className="label">Team</label>
                      <select className="input" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
                        <option value="">Select one of your teams</option>
                        {teams.map((team) => <option key={team.id} value={team.id}>{team.name} ({team.members?.length || 0} players)</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="formStack">
                      <div>
                        <label className="label">Team name</label>
                        <input className="input" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" />
                      </div>
                      <div className="small">Add 1 or 3 teammates. You are automatically included, so tournament teams must total exactly 2 or 4 players.</div>
                      {newTeamMembers.map((member, index) => (
                        <div key={member.id} className="grid" style={{ gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                          <input className="input" value={member.name} onChange={(e) => setNewTeamMembers((prev) => prev.map((item) => item.id === member.id ? { ...item, name: e.target.value } : item))} placeholder={`Teammate ${index + 1} name`} />
                          <input className="input" value={member.email} onChange={(e) => setNewTeamMembers((prev) => prev.map((item) => item.id === member.id ? { ...item, email: e.target.value } : item))} placeholder="email@example.com" />
                          <button type="button" className="btn" onClick={() => setNewTeamMembers((prev) => prev.filter((item) => item.id !== member.id))}>Remove</button>
                        </div>
                      ))}
                      {newTeamMembers.length < 3 ? <button type="button" className="btn" onClick={() => setNewTeamMembers((prev) => [...prev, { id: crypto.randomUUID(), name: '', email: '' }])}>+ Add teammate</button> : null}
                    </div>
                  )}
                </div>
              ) : null}
              {registered ? (
                <div className="small" style={{ color: '#166534', fontWeight: 700 }}>You are already registered for this tournament.</div>
              ) : (
                <button className="btn btnPrimary" type="button" disabled={registering || registrationClosed || authLoading} onClick={onRegister}>
                  {registering ? 'Registering…' : user ? 'Register for tournament team' : 'Create account to register'}
                </button>
              )}
            </div>
            <div className="card" style={{ padding: 16 }}>
              <strong>Teams signed up</strong>
              {portal?.registrations?.length ? (
                <div className="formStack" style={{ marginTop: 10 }}>
                  {portal.registrations.map((registration) => (
                    <div key={registration.id} className="card" style={{ padding: 12, background: '#f8fafc' }}>
                      <div><strong>{registration.teamName || 'Team pending name'}</strong></div>
                      <div className="small">Signed up: {formatFriendlyDateTime(registration.registeredAt)}</div>
                      <div className="small" style={{ marginTop: 6 }}>Members: {(registration.teamMembers || []).map((member) => `${member.name || member.email} <${member.email}>`).join(', ') || registration.email}</div>
                    </div>
                  ))}
                </div>
              ) : <div className="small" style={{ marginTop: 8 }}>No teams have signed up yet.</div>}
            </div>
            </div>
          </>
        ) : <Link className="btn" to="/">Go home</Link>}
      </div>
    </div>
  )
}
