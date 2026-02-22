import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import { createTeam, fetchTeams } from '../lib/teams'
import type { Team } from '../types'

type DraftMember = { name: string; email: string }

export default function TeamsPage() {
  return (
    <ProtectedRoute>
      <TeamsInner />
    </ProtectedRoute>
  )
}

function TeamsInner() {
  const [teams, setTeams] = useState<Team[]>([])
  const [name, setName] = useState('')
  const [members, setMembers] = useState<DraftMember[]>([{ name: '', email: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const t = await fetchTeams()
        setTeams(t)
      } catch (e: any) {
        setErr(e.message || 'Failed to load teams')
      }
    })()
  }, [])

  const sorted = useMemo(() => {
    return [...teams].sort((a, b) => a.name.localeCompare(b.name))
  }, [teams])

  const cleanedMembers = useMemo(() => {
    return members
      .map(m => ({ name: m.name.trim(), email: m.email.trim() }))
      .filter(m => m.name || m.email)
  }, [members])

  return (
    <div className="container">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Teams</h2>
        <div className="small">
          Create teams once, then select them anywhere you see the Team filter.
          Teams and members are stored locally in <code>server/data/teams.json</code>.
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
          <div style={{ maxWidth: 520 }}>
            <label className="label">Team name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., The Birdies"
            />
          </div>

          <div>
            <div className="label" style={{ marginBottom: 6 }}>Team members</div>
            <div className="small" style={{ marginBottom: 10 }}>
              Add member name + email. (This is used for keeping rosters; score logging still uses team name.)
            </div>

            <div style={{ display: 'grid', gap: 8, maxWidth: 720 }}>
              {members.map((m, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                  <div style={{ minWidth: 220 }}>
                    <label className="label">Name</label>
                    <input
                      className="input"
                      value={m.name}
                      onChange={(e) => setMembers(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                      placeholder="e.g., Jordan Smith"
                    />
                  </div>
                  <div style={{ minWidth: 260 }}>
                    <label className="label">Email</label>
                    <input
                      className="input"
                      value={m.email}
                      onChange={(e) => setMembers(prev => prev.map((x, i) => i === idx ? { ...x, email: e.target.value } : x))}
                      placeholder="e.g., jordan@example.com"
                    />
                  </div>
                  <div>
                    <button
                      className="btn"
                      disabled={members.length === 1}
                      onClick={() => setMembers(prev => prev.filter((_, i) => i !== idx))}
                      title="Remove member"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                className="btn"
                onClick={() => setMembers(prev => [...prev, { name: '', email: '' }])}
              >
                + Add member
              </button>
            </div>
          </div>

          <div>
            <button
              className="btn btnPrimary"
              disabled={busy}
              onClick={async () => {
                setBusy(true); setErr(null); setMsg(null)
                try {
                  const created = await createTeam(name, cleanedMembers)
                  setTeams((prev) => {
                    const next = [...prev, created]
                    next.sort((a, b) => a.name.localeCompare(b.name))
                    return next
                  })
                  setName('')
                  setMembers([{ name: '', email: '' }])
                  setMsg('Team created.')
                } catch (e: any) {
                  setErr(e.message || 'Failed to create team')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Creating…' : 'Create Team'}
            </button>
          </div>
        </div>

        {msg ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{msg}</div> : null}
        {err ? <div className="small" style={{ color: '#b91c1c', marginTop: 12 }}>{err}</div> : null}

        <div style={{ height: 16 }} />

        <h3 style={{ marginBottom: 8 }}>Available teams</h3>
        {sorted.length === 0 ? (
          <div className="small">No teams yet. Create one above.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {sorted.map((t) => (
              <div key={t.id} className="card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <div style={{ fontWeight: 700 }}>{t.name}</div>
                  <div className="small">{(t.members?.length || 0)} member(s)</div>
                </div>
                {t.members && t.members.length > 0 ? (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {t.members.map((m) => (
                      <span key={m.id} className="pill" title={m.email}>{m.name}</span>
                    ))}
                  </div>
                ) : (
                  <div className="small" style={{ marginTop: 10 }}>No members saved for this team.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
