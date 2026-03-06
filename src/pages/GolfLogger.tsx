import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import ProtectedRoute from '../components/ProtectedRoute'
import type { ScoreEntry, TeamMember } from '../types'
import { US_STATES } from '../data/usStates'
import { getCoursesForState } from '../data/coursesByState'
import { createTeam, fetchTeams } from '../lib/teams'
import { useAuth } from '../context/AuthContext'
import PageHero from '../components/PageHero'

const NUM_HOLES = 18
type DraftMember = { firstName: string; lastName: string; email: string }

export default function GolfLoggerPage() {
  return (
    <ProtectedRoute>
      <GolfLoggerInner />
    </ProtectedRoute>
  )
}

function GolfLoggerInner() {
  const { user } = useAuth()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [stateAbbr, setStateAbbr] = useState('UT')
  const [allTeams, setAllTeams] = useState<string[]>([])
  const [myTeams, setMyTeams] = useState<string[]>([])
  const [course, setCourse] = useState('')
  const [team, setTeam] = useState('')
  const [opponentTeam, setOpponentTeam] = useState('')
  const [teamTotal, setTeamTotal] = useState<string>('')
  const [opponentTotal, setOpponentTotal] = useState<string>('')
  const [useHoles, setUseHoles] = useState(false)
  const [holes, setHoles] = useState<number[]>(Array(NUM_HOLES).fill(0))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newMembers, setNewMembers] = useState<DraftMember[]>([{ firstName: '', lastName: '', email: user?.email || '' }])

  async function loadTeams() {
    try {
      const t = await fetchTeams()
      const names = t.map(x => x.name).sort((a, b) => a.localeCompare(b))
      setAllTeams(names)

      const myEmail = String(user?.email || '').toLowerCase()
      const mine = myEmail
        ? t.filter(teamObj => Array.isArray(teamObj.members) && teamObj.members.some((m: any) => String(m.email || '').toLowerCase() === myEmail))
            .map(x => x.name)
            .sort((a, b) => a.localeCompare(b))
        : []
      setMyTeams(mine)

      if (mine.length > 0) {
        setTeam(prev => (mine.includes(prev) ? prev : mine[0]))
      } else {
        setTeam('')
      }
    } catch {
      setAllTeams([])
      setMyTeams([])
    }
  }

  useEffect(() => {
    loadTeams()
  }, [user?.email])

  useEffect(() => {
    setNewMembers(prev => {
      if (!prev.length) return [{ firstName: '', lastName: '', email: user?.email || '' }]
      const next = [...prev]
      if (!next[0].email && user?.email) next[0] = { ...next[0], email: user.email }
      return next
    })
  }, [user?.email])

  const holesTotal = useMemo(() => holes.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), [holes])
  const courseOptions = useMemo(() => getCoursesForState(stateAbbr), [stateAbbr])

  const totals = useMemo(() => {
    const your = Number(teamTotal)
    const opp = Number(opponentTotal)
    const valid = teamTotal !== '' && opponentTotal !== '' && Number.isFinite(your) && Number.isFinite(opp)
    const result = !valid ? '' : (your < opp ? 'Win' : your > opp ? 'Loss' : 'Tie')
    const diff = !valid ? 0 : Math.abs(opp - your)
    const money = !valid ? 0 : (your < opp ? diff : your > opp ? -diff : 0)
    return { your, opp, valid, result, money }
  }, [teamTotal, opponentTotal])

  const moneyText = useMemo(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totals.money), [totals.money])
  const resultClass = totals.result === 'Win' ? 'eventWin' : totals.result === 'Loss' ? 'eventLoss' : totals.result === 'Tie' ? 'eventTie' : ''

  const missingFields = useMemo(() => {
    const missing: string[] = []
    if (!date) missing.push('Date')
    if (date && date > today) missing.push('Date cannot be in the future')
    if (!stateAbbr) missing.push('State')
    if (!course.trim()) missing.push('Course')
    if (!team.trim()) missing.push('Your team')
    if (!opponentTeam.trim()) missing.push('Opponent team')
    if (team.trim() && opponentTeam.trim() && team.trim().toLowerCase() === opponentTeam.trim().toLowerCase()) missing.push('Opponent team must be different from your team')
    if (teamTotal === '' || !Number.isFinite(Number(teamTotal))) missing.push('Your team round score')
    if (opponentTotal === '' || !Number.isFinite(Number(opponentTotal))) missing.push('Opponent round score')
    return missing
  }, [date, today, stateAbbr, course, team, opponentTeam, teamTotal, opponentTotal])

  const cleanedNewMembers = useMemo(() => {
    return newMembers
      .map(m => ({ name: `${m.firstName} ${m.lastName}`.trim(), email: m.email.trim() }))
      .filter(m => m.name || m.email)
  }, [newMembers])

  const createMissing = useMemo(() => {
    const missing: string[] = []
    if (!newTeamName.trim()) missing.push('Team name')
    if (!cleanedNewMembers.length) missing.push('At least one team member')
    cleanedNewMembers.forEach((member, idx) => {
      if (!member.name) missing.push(`Member ${idx + 1} full name`)
      if (!member.email) missing.push(`Member ${idx + 1} email`)
    })
    if (cleanedNewMembers.length > 4) missing.push('Only four team members are allowed')
    return missing
  }, [newTeamName, cleanedNewMembers])

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Team scramble"
          title="Log a team round fast"
          subtitle="Keep the roster-aware workflow, get the result auto-calculated, and save without extra clicks."
        />

        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => { setShowCreateTeam(v => !v); setErr(null); setMsg(null) }}>
            {showCreateTeam ? 'Hide Create Team' : 'Create Team'}
          </button>
        </div>

        {showCreateTeam ? (
          <div className="card" style={{ marginTop: 14, background: '#fafbff' }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Create Team</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ maxWidth: 560 }}>
                <label className="label">Team name</label>
                <input className="input" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="e.g. Fairway Finders" />
              </div>
              <div>
                <div className="label" style={{ marginBottom: 6 }}>Team members (max 4)</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {newMembers.map((m, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                      <div style={{ minWidth: 170, flex: 1 }}>
                        <label className="label">First name</label>
                        <input className="input" value={m.firstName} onChange={e => setNewMembers(prev => prev.map((x, i) => i === idx ? { ...x, firstName: e.target.value } : x))} />
                      </div>
                      <div style={{ minWidth: 170, flex: 1 }}>
                        <label className="label">Last name</label>
                        <input className="input" value={m.lastName} onChange={e => setNewMembers(prev => prev.map((x, i) => i === idx ? { ...x, lastName: e.target.value } : x))} />
                      </div>
                      <div style={{ minWidth: 250, flex: 1.2 }}>
                        <label className="label">Email</label>
                        <input className="input" type="email" value={m.email} onChange={e => setNewMembers(prev => prev.map((x, i) => i === idx ? { ...x, email: e.target.value } : x))} />
                      </div>
                      <button type="button" className="btn" disabled={newMembers.length === 1} onClick={() => setNewMembers(prev => prev.filter((_, i) => i !== idx))}>Remove</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                  <button type="button" className="btn" disabled={newMembers.length >= 4} onClick={() => setNewMembers(prev => [...prev, { firstName: '', lastName: '', email: '' }])}>+ Add member</button>
                  <button
                    type="button"
                    className="btnPrimary"
                    disabled={busy}
                    onClick={async () => {
                      if (createMissing.length) {
                        setErr(`Please complete: ${createMissing.join(', ')}`)
                        return
                      }
                      setBusy(true)
                      setErr(null)
                      setMsg(null)
                      try {
                        const created = await createTeam(newTeamName.trim(), cleanedNewMembers as Omit<TeamMember, 'id'>[])
                        setMsg(`Team ${created.name} created.`)
                        setShowCreateTeam(false)
                        setNewTeamName('')
                        setNewMembers([{ firstName: '', lastName: '', email: user?.email || '' }])
                        await loadTeams()
                        setTeam(created.name)
                      } catch (e: any) {
                        setErr(e.message || 'Failed to create team')
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    {busy ? 'Creating…' : 'Save Team'}
                  </button>
                </div>
                {createMissing.length ? <div className="small" style={{ color: '#b91c1c', marginTop: 10 }}>Missing or invalid: {createMissing.join(', ')}</div> : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid2" style={{ marginTop: 14 }}>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">State</label>
            <select className="input" value={stateAbbr} onChange={(e) => { setStateAbbr(e.target.value); setCourse('') }}>
              {US_STATES.map(s => (
                <option key={s.abbr} value={s.abbr}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Course</label>
            <input className="input" list="courseOptionsByState" value={course} onChange={e => setCourse(e.target.value)} placeholder="Start typing a course…" />
            <datalist id="courseOptionsByState">
              {courseOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label">Your team</label>
            <input
              className="input"
              list="my-teams-list"
              value={team}
              onChange={e => {
                const nextTeam = e.target.value
                setTeam(nextTeam)
                if (nextTeam && nextTeam.trim().toLowerCase() === String(opponentTeam || '').trim().toLowerCase()) setOpponentTeam('')
              }}
              placeholder={myTeams.length ? 'Select your team…' : 'Create a team first'}
            />
            <datalist id="my-teams-list">
              {myTeams.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="small" style={{ marginTop: 6 }}>Only teams you are a member of are available to log rounds for.</div>
          </div>
          <div>
            <label className="label">Opponent team</label>
            <input className="input" list="opponent-teams-list" value={opponentTeam} onChange={e => setOpponentTeam(e.target.value)} placeholder="Select or type…" />
            <datalist id="opponent-teams-list">
              {allTeams.filter(t => t.toLowerCase() !== String(team || '').trim().toLowerCase()).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="small" style={{ marginTop: 6 }}>Opponent is required and must be different from your team.</div>
          </div>
          <div>
            <label className="label">{team ? `${team} Round Score` : 'Your Team Round Score'}</label>
            <input className="input" type="number" value={teamTotal} onChange={e => setTeamTotal(e.target.value)} />
          </div>
          <div>
            <label className="label">{opponentTeam ? `${opponentTeam} Round Score` : 'Opponent Round Score'}</label>
            <input className="input" type="number" value={opponentTotal} onChange={e => setOpponentTotal(e.target.value)} />
          </div>
          <div>
            <label className="label">Money Won / Lost</label>
            <input className={`input inputReadOnly ${resultClass}`} readOnly value={totals.valid ? moneyText : ''} />
            <div className="small" style={{ marginTop: 6 }}>Automatically calculated using standard golf scoring (lower score wins).</div>
          </div>
          <div>
            <label className="label">Result</label>
            <input className={`input inputReadOnly ${resultClass}`} readOnly value={totals.result} />
            <div className="small" style={{ marginTop: 6 }}>Read-only and computed from the two round scores.</div>
          </div>
          <div>
            <label className="label">Per-hole entry (future-friendly)</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={useHoles} onChange={e => setUseHoles(e.target.checked)} />
              <span className="small">Enable 18-hole inputs (optional)</span>
            </div>
            {useHoles ? <div className="small" style={{ marginTop: 6 }}>Per-hole total: <strong>{holesTotal}</strong></div> : null}
          </div>
        </div>

        {useHoles ? (
          <div className="card" style={{ marginTop: 16, background: '#fafbff' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Hole Scores (Course specific)</div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10 }}>
              {holes.map((v, idx) => (
                <div key={idx}>
                  <label className="label">Hole {idx + 1}</label>
                  <input className="input" type="number" value={v} onChange={e => { const next = holes.slice(); next[idx] = Number(e.target.value); setHoles(next) }} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {msg ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{msg}</div> : null}
        {missingFields.length ? <div className="small" style={{ color: '#b91c1c', marginTop: 12 }}>Missing or invalid: {missingFields.join(', ')}</div> : null}
        {err ? <div className="small" style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btnPrimary"
            disabled={busy}
            onClick={async () => {
              if (missingFields.length) {
                setErr(`Please complete: ${missingFields.join(', ')}`)
                return
              }
              setBusy(true)
              setErr(null)
              setMsg(null)
              try {
                const trimmedTeam = String(team || '').trim()
                const trimmedOpp = String(opponentTeam || '').trim()
                if (!date) throw new Error('Date is required')
                if (date > today) throw new Error('Date cannot be in the future')
                if (!stateAbbr) throw new Error('State is required')
                if (!trimmedTeam) throw new Error('Team is required')
                if (!trimmedOpp) throw new Error('Opponent team is required')
                if (trimmedTeam.toLowerCase() === trimmedOpp.toLowerCase()) throw new Error('Opponent team must be different from your team')
                if (!course.trim()) throw new Error('Course is required')
                if (!totals.valid) throw new Error('Please enter both round scores')

                const body: Partial<ScoreEntry> & any = {
                  date,
                  state: stateAbbr,
                  course,
                  team: trimmedTeam,
                  opponentTeam: trimmedOpp,
                  teamTotal: totals.your,
                  opponentTotal: totals.opp,
                  holes: useHoles ? holes : null
                }
                await api<ScoreEntry>('/api/scores', { method: 'POST', body: JSON.stringify(body) })
                setMsg('Saved! Go to Home to see updated dashboard.')
                setCourse('')
                setTeam(myTeams[0] || '')
                setOpponentTeam('')
                setTeamTotal('')
                setOpponentTotal('')
                setHoles(Array(NUM_HOLES).fill(0))
              } catch (e: any) {
                setErr(e.message || 'Failed to save')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Save Round'}
          </button>
        </div>
      </div>
    </div>
  )
}
