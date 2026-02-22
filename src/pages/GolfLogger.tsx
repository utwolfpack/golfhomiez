import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import ProtectedRoute from '../components/ProtectedRoute'
import type { ScoreEntry } from '../types'
import { UTAH_GOLF_COURSE_NAMES } from '../data/utahCourses'
import { fetchTeams } from '../lib/teams'

const NUM_HOLES = 18

export default function GolfLoggerPage() {
  return (
    <ProtectedRoute>
      <GolfLoggerInner />
    </ProtectedRoute>
  )
}

function GolfLoggerInner() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [availableTeams, setAvailableTeams] = useState<string[]>([])
  const [course, setCourse] = useState('')
  const [team, setTeam] = useState('')
  const [opponentTeam, setOpponentTeam] = useState('')
  const [teamTotal, setTeamTotal] = useState<number>(0)
  const [opponentTotal, setOpponentTotal] = useState<number>(0)
  const [money, setMoney] = useState<number>(0)
  const [useHoles, setUseHoles] = useState(false)
  const [holes, setHoles] = useState<number[]>(Array(NUM_HOLES).fill(0))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const t = await fetchTeams()
        setAvailableTeams(t.map(x => x.name).sort((a,b)=>a.localeCompare(b)))
      } catch {
        setAvailableTeams([])
      }
    })()
  }, [])

  const holesTotal = useMemo(() => holes.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), [holes])

  return (
    <div className="container">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Golf Logger</h2>
        <div className="small">
          Log a round. Scores are stored locally in <code>server/data/scores.json</code>.
        </div>

        <div className="grid grid2" style={{ marginTop: 14 }}>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Course</label>
            <input
              className="input"
              list="utah-courses"
              value={course}
              onChange={e => setCourse(e.target.value)}
              placeholder="Start typing a Utah course…"
            />
            <datalist id="utah-courses">
              {UTAH_GOLF_COURSE_NAMES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="small" style={{ marginTop: 6 }}>Filters are course-specific.</div>
          </div>

          <div>
            <label className="label">Team</label>
            <input className="input" list="teams-list" value={team} onChange={e => setTeam(e.target.value)} placeholder="Select or type a team…" />
            <datalist id="teams-list">
              {availableTeams.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="small" style={{ marginTop: 6 }}>Filters are team-specific (supports multiple teams).</div>
          </div>
          <div>
            <label className="label">Opponent Team (optional)</label>
            <input className="input" list="teams-list" value={opponentTeam} onChange={e => setOpponentTeam(e.target.value)} placeholder="Select or type…" />
          </div>

          <div>
            <label className="label">Your Team Total</label>
            <input
              className="input"
              type="number"
              value={teamTotal}
              onChange={e => setTeamTotal(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Opponent Total</label>
            <input
              className="input"
              type="number"
              value={opponentTotal}
              onChange={e => setOpponentTotal(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="label">Money Won / Lost</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={money}
              onChange={e => setMoney(Number(e.target.value))}
            />
            <div className="small" style={{ marginTop: 6 }}>Use positive for won, negative for lost.</div>
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
                  <input
                    className="input"
                    type="number"
                    value={v}
                    onChange={e => {
                      const next = holes.slice()
                      next[idx] = Number(e.target.value)
                      setHoles(next)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {msg ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{msg}</div> : null}
        {err ? <div className="small" style={{ color: '#b91c1c', marginTop: 12 }}>{err}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            className="btn btnPrimary"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setErr(null); setMsg(null)
              try {
                const body: Partial<ScoreEntry> & any = {
                  date, course, team, opponentTeam,
                  teamTotal: Number(teamTotal),
                  opponentTotal: Number(opponentTotal),
                  money: Number(money),
                  holes: useHoles ? holes : null
                }
                await api<ScoreEntry>('/api/scores', { method: 'POST', body: JSON.stringify(body) })
                setMsg('Saved! Go to Home to see updated dashboard.')
                setCourse(''); setTeam(''); setOpponentTeam('')
                setTeamTotal(0); setOpponentTotal(0); setMoney(0)
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
          <a className="btn" href="/">Back to dashboard</a>
        </div>
      </div>
    </div>
  )
}
