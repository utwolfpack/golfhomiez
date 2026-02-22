import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { ScoreEntry } from '../types'
import StatCard from '../components/StatCard'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import { UTAH_GOLF_COURSE_NAMES } from '../data/utahCourses'
import bannerImg from '../assets/golf-banner.png'
import { fetchTeams } from '../lib/teams'
import { jumpToFirstByLetter } from '../lib/selectHotkey'

function formatMoney(n: number) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toFixed(2)}`
}

export default function Home() {
  const { user } = useAuth()
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [teams, setTeams] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [courseFilter, setCourseFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')

  useEffect(() => {
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const data = await api<ScoreEntry[]>('/api/scores')
        setScores(data)
        try {
          const t = await fetchTeams()
          setTeams(t.map(x => x.name))
        } catch {
          setTeams([])
        }
      } catch (e: any) {
        // if not logged in, just show empty dashboard prompt
        setScores([])
        setTeams([])
        setError(e.message || null)
      } finally {
        setLoading(false)
      }
    })()
  }, [user])

  const courseLists = useMemo(() => {
    const utah = Array.from(new Set(UTAH_GOLF_COURSE_NAMES)).sort()
    const other = Array.from(new Set(scores.map((s) => s.course).filter(Boolean)))
      .filter((c) => !utah.includes(c))
      .sort()
    return { utah, other }
  }, [scores])
  const teamsSorted = useMemo(() => {
    const fromScores = scores.map(s => s.team).filter(Boolean)
    const all = Array.from(new Set([...(teams || []), ...fromScores]))
    all.sort((a, b) => a.localeCompare(b))
    return all
  }, [scores, teams])

  const filtered = useMemo(() => {
    return scores.filter(s =>
      (courseFilter === 'all' || s.course === courseFilter) &&
      (teamFilter === 'all' || s.team === teamFilter)
    )
  }, [scores, courseFilter, teamFilter])

  const stats = useMemo(() => {
    const total = filtered.length
    const wins = filtered.filter(s => s.won === true).length
    const losses = filtered.filter(s => s.won === false).length
    const ties = filtered.filter(s => s.won === null).length
    const winPct = total === 0 ? 0 : (wins / total) * 100
    const money = filtered.reduce((sum, s) => sum + (s.money || 0), 0)
    return { total, wins, losses, ties, winPct, money }
  }, [filtered])

  return (
    <div className="container">
      <div className="bannerCard">
        <img src={bannerImg} alt="Golf Scramble banner" className="bannerImg" />
        <div className="bannerOverlay">
          <div className="bannerTitle">Fairways, Friends & Winnings</div>
          <div className="bannerSubtitle">Track rounds • See stats • Keep the smack talk honest</div>
        </div>
      </div>
      <div className="grid grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Home Dashboard</h2>

          {!user ? (
            <div className="small">
              Please <Link to="/login"><strong>login</strong></Link> to view and track rounds.
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ minWidth: 220 }}>
              <label className="label">Filter by course</label>
              <select
                className="input"
                value={courseFilter}
                onChange={e => setCourseFilter(e.target.value)}
                onKeyDown={(e) => {
                  const items = [...courseLists.utah, ...courseLists.other].map((c) => ({ value: c }))
                  jumpToFirstByLetter(e.key, items, setCourseFilter, courseFilter)
                }}
              >
                <option value="all">All courses</option>
                <optgroup label="Utah courses">
                  {courseLists.utah.map(c => <option key={c} value={c}>{c}</option>)}
                </optgroup>
                {courseLists.other.length ? (
                  <optgroup label="Other (from your logs)">
                    {courseLists.other.map(c => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                ) : null}
              </select>
            </div>

            <div style={{ minWidth: 220 }}>
              <label className="label">Filter by team</label>
              <select
                className="input"
                value={teamFilter}
                onChange={e => setTeamFilter(e.target.value)}
                onKeyDown={(e) => {
                  const items = teamsSorted.map((t) => ({ value: t }))
                  jumpToFirstByLetter(e.key, items, setTeamFilter, teamFilter)
                }}
              >
                <option value="all">All teams</option>
                {teamsSorted.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div style={{ alignSelf: 'end' }}>
              <Link className="btn btnPrimary" to="/golf-logger">Log a round</Link>
            </div>
          </div>

          <div className="small" style={{ marginTop: 12 }}>
            Winning % and money are calculated from the filtered rounds.
          </div>

          {loading ? <div className="small" style={{ marginTop: 10 }}>Loading…</div> : null}
          {error && user ? <div className="small" style={{ color: '#b91c1c', marginTop: 10 }}>{error}</div> : null}
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
          <StatCard title="Winning Percentage" value={`${stats.winPct.toFixed(1)}%`} subtitle={`${stats.wins}W • ${stats.losses}L • ${stats.ties}T`} />
          <StatCard title="Money Won/Lost" value={formatMoney(stats.money)} subtitle={`${stats.total} rounds`} />
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Recent Rounds</h3>
        {filtered.length === 0 ? (
          <div className="small">No rounds logged for the current filters.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Course</th>
                <th>Team</th>
                <th>Score</th>
                <th>Result</th>
                <th>Money</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 10).map(r => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.course}</td>
                  <td><span className="pill">{r.team}</span></td>
                  <td>{r.teamTotal} vs {r.opponentTotal}</td>
                  <td>{r.won === true ? 'Win' : r.won === false ? 'Loss' : 'Tie'}</td>
                  <td>{formatMoney(r.money)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
