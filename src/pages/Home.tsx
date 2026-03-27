import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import bannerImg from '../assets/golf-banner.png'
import RoundDetailModal from '../components/RoundDetailModal'
import HandicapBreakdownModal from '../components/HandicapBreakdownModal'
import HandicapSummaryCard from '../components/HandicapSummaryCard'
import StatCard from '../components/StatCard'
import { useAuth } from '../context/AuthContext'
import { US_STATES } from '../data/usStates'
import { api } from '../lib/api'
import { GUEST_HOME_EMAIL, GUEST_HOME_SCORES } from '../lib/dashboardSample'
import { jumpToFirstByLetter } from '../lib/selectHotkey'
import { sortScoresNewestFirst } from '../lib/roundInsights'
import { calculateHandicapFromScores } from '../lib/handicap'
import type { ScoreEntry, SoloScoreEntry, TeamScoreEntry } from '../types'

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function isTeamScore(s: ScoreEntry): s is TeamScoreEntry {
  return (s as any).mode !== 'solo'
}

function isSoloScore(s: ScoreEntry): s is SoloScoreEntry {
  return (s as any).mode === 'solo'
}

function roundRowClass(round: ScoreEntry) {
  if (round.mode !== 'team') return 'roundRow'
  return `roundRow ${round.won === true ? 'rowWin' : round.won === false ? 'rowLoss' : 'rowTie'}`
}

function RoundRow({ round, onClick }: { round: ScoreEntry; onClick: () => void }) {
  if (round.mode === 'solo') {
    return (
      <button type="button" className={roundRowClass(round)} onClick={onClick}>
        <div>
          <div className="roundRowTitle">{round.course}</div>
          <div className="roundRowMeta">{round.date} • {String((round as any).state || '').toUpperCase()} • Solo round</div>
        </div>
        <div className="roundRowSummary">
          <div className="roundRowValue">{round.roundScore}</div>
          <div className="small">Tap for details</div>
        </div>
      </button>
    )
  }

  const result = round.won === true ? 'Win' : round.won === false ? 'Loss' : 'Tie'
  return (
    <button type="button" className={roundRowClass(round)} onClick={onClick}>
      <div>
        <div className="roundRowTitle">{round.course}</div>
        <div className="roundRowMeta">{round.date} • {String((round as any).state || '').toUpperCase()} • {round.team} vs {round.opponentTeam}</div>
      </div>
      <div className="roundRowSummary">
        <div className="roundRowValue">{round.teamTotal}-{round.opponentTotal}</div>
        <div className="small">{result} • {formatMoney(round.money || 0)}</div>
      </div>
    </button>
  )
}

export default function Home() {
  const { user } = useAuth()
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<ScoreEntry | null>(null)
  const [showHandicapModal, setShowHandicapModal] = useState(false)

  const [view, setView] = useState<'all' | 'team' | 'solo'>('all')
  const [stateFilter, setStateFilter] = useState('UT')
  const [courseFilter, setCourseFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')

  useEffect(() => {
    ;(async () => {
      if (!user) {
        setScores(GUEST_HOME_SCORES)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const data = await api<ScoreEntry[]>('/api/scores')
        const normalized = data.map((s: any) => ({ ...s, mode: s.mode || 'team' }))
        setScores(normalized)
      } catch (e: any) {
        setScores([])
        setError(e?.message || null)
      } finally {
        setLoading(false)
      }
    })()
  }, [user])

  const userScores = useMemo(() => {
    const email = String(user?.email || GUEST_HOME_EMAIL).toLowerCase()
    if (!email) return []
    return scores.filter((s) => String((s as any).createdByEmail || '').toLowerCase() === email)
  }, [scores, user?.email])

  const scopedScores = useMemo(() => {
    return userScores.filter((s) => (view === 'all' ? true : view === 'solo' ? isSoloScore(s) : isTeamScore(s)))
  }, [userScores, view])

  const nameByAbbr = useMemo(() => new Map(US_STATES.map((s) => [s.abbr, s.name])), [])
  const stateOptions = useMemo(() => {
    const fromLogs = scopedScores.map((s) => String((s as any).state || '').toUpperCase()).filter(Boolean)
    const unique = Array.from(new Set(fromLogs))
    const list = unique.length ? unique : ['UT']
    return Array.from(new Set(list)).sort((a, b) => {
      if (a === 'UT') return -1
      if (b === 'UT') return 1
      return (nameByAbbr.get(a) || a).localeCompare(nameByAbbr.get(b) || b)
    })
  }, [scopedScores, nameByAbbr])

  useEffect(() => {
    if (stateOptions.length && stateFilter !== 'all' && !stateOptions.includes(stateFilter)) {
      setStateFilter(stateOptions[0])
      setCourseFilter('all')
      setTeamFilter('all')
    }
  }, [stateOptions, stateFilter])

  const courseOptions = useMemo(() => {
    return Array.from(new Set(scopedScores
      .filter((s: any) => stateFilter === 'all' ? true : String(s.state || '').toUpperCase() === stateFilter)
      .map((s) => s.course)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [scopedScores, stateFilter])

  const teamOptions = useMemo(() => {
    return Array.from(new Set(scopedScores
      .filter(isTeamScore)
      .filter((s: any) => stateFilter === 'all' ? true : String(s.state || '').toUpperCase() === stateFilter)
      .filter((s) => courseFilter === 'all' ? true : s.course === courseFilter)
      .map((s) => s.team)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [scopedScores, stateFilter, courseFilter])

  const filteredScores = useMemo(() => {
    return scopedScores.filter((s: any) => {
      if (stateFilter !== 'all' && String(s.state || '').toUpperCase() !== stateFilter) return false
      if (courseFilter !== 'all' && s.course !== courseFilter) return false
      if (view === 'team' && teamFilter !== 'all' && s.team !== teamFilter) return false
      if (view === 'all' && teamFilter !== 'all' && s.mode === 'team' && s.team !== teamFilter) return false
      return true
    })
  }, [scopedScores, view, stateFilter, courseFilter, teamFilter])

  const teamScores = useMemo(() => filteredScores.filter(isTeamScore), [filteredScores])
  const soloScores = useMemo(() => filteredScores.filter(isSoloScore), [filteredScores])
  const recent = useMemo(() => sortScoresNewestFirst(filteredScores), [filteredScores])
  const recentRounds = useMemo(() => recent.slice(0, 10), [recent])

  const teamStats = useMemo(() => {
    const total = teamScores.length
    const wins = teamScores.filter((s) => s.won === true).length
    const losses = teamScores.filter((s) => s.won === false).length
    const ties = teamScores.filter((s) => s.won === null).length
    const money = teamScores.reduce((sum, s) => sum + (s.money || 0), 0)
    return { total, wins, losses, ties, money, winPct: total ? (wins / total) * 100 : 0 }
  }, [teamScores])

  const soloStats = useMemo(() => {
    const total = soloScores.length
    const avg = total ? soloScores.reduce((sum, s) => sum + s.roundScore, 0) / total : 0
    const best = total ? Math.min(...soloScores.map((s) => s.roundScore)) : 0
    return { total, avg, best }
  }, [soloScores])
  const handicapStats = useMemo(() => calculateHandicapFromScores(filteredScores), [filteredScores])

  const tileCards = useMemo(() => {
    const cards = [
      <StatCard key="rounds" title="Rounds" value={String(filteredScores.length)} subtitle="Current filtered view" />,
    ]

    if (view !== 'solo') {
      cards.push(
        <StatCard key="record" title="Team Record" value={`${teamStats.wins}-${teamStats.losses}${teamStats.ties ? `-${teamStats.ties}` : ''}`} subtitle={`${teamStats.winPct.toFixed(0)}% win rate`} />,
        <StatCard key="money" title="Money" value={formatMoney(teamStats.money)} subtitle="Team events only" />,
      )
    }

    if (view !== 'team') {
      cards.push(
        <StatCard key="soloAvg" title="Solo Avg" value={soloStats.total ? soloStats.avg.toFixed(1) : '—'} subtitle={soloStats.total ? `Best ${soloStats.best}` : 'No solo rounds'} />,
        <HandicapSummaryCard key="soloHandicap" stats={handicapStats} onClick={() => setShowHandicapModal(true)} />,
      )
    }

    return cards
  }, [filteredScores.length, view, teamStats, soloStats, handicapStats])

  return (
    <div className="container">
      <div className="bannerCard">
        <img src={bannerImg} alt="Golf Homiez banner" className="bannerImg" />
        <div className="bannerOverlay">
          <div className="bannerTitle">Fairways, Friends & Scorecards</div>
          <div className="bannerSubtitle">Track scrambles • Track solo rounds • Keep it fun</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Dashboard</h2>
            <div className="small">Smaller stats up top, bigger score rows below.</div>
          </div>
          {!user ? <div className="small">Showing homepage demo data. <Link to="/login"><strong>Log in</strong></Link> to view and track your own rounds.</div> : null}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className={view === 'all' ? 'btnPrimary btnSmall' : 'btn btnSmall'} onClick={() => { setView('all'); setTeamFilter('all') }}>All Rounds</button>
          <button type="button" className={view === 'team' ? 'btnPrimary btnSmall' : 'btn btnSmall'} onClick={() => { setView('team'); setTeamFilter('all') }}>Team Scrambles</button>
          <button type="button" className={view === 'solo' ? 'btnPrimary btnSmall' : 'btn btnSmall'} onClick={() => { setView('solo'); setTeamFilter('all') }}>Solo Rounds</button>
        </div>

        <div className="filtersCompactGrid" style={{ marginTop: 14 }}>
          <div>
            <label className="label">State</label>
            <select className="input" value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setCourseFilter('all'); setTeamFilter('all') }} onKeyDown={(e) => jumpToFirstByLetter(e, stateOptions, (v) => { setStateFilter(v); setCourseFilter('all'); setTeamFilter('all') })}>
              {stateOptions.length > 1 ? <option value="all">All states</option> : null}
              {stateOptions.map((abbr) => <option key={abbr} value={abbr}>{nameByAbbr.get(abbr) || abbr}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Course</label>
            <select className="input" value={courseFilter} onChange={(e) => { setCourseFilter(e.target.value); setTeamFilter('all') }} onKeyDown={(e) => jumpToFirstByLetter(e, courseOptions, (v) => { setCourseFilter(v); setTeamFilter('all') })}>
              <option value="all">All courses</option>
              {courseOptions.map((course) => <option key={course} value={course}>{course}</option>)}
            </select>
          </div>
          {view !== 'solo' ? (
            <div>
              <label className="label">Team</label>
              <select className="input" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} onKeyDown={(e) => jumpToFirstByLetter(e, teamOptions, (v) => setTeamFilter(v))}>
                <option value="all">All teams</option>
                {teamOptions.map((teamName) => <option key={teamName} value={teamName}>{teamName}</option>)}
              </select>
            </div>
          ) : null}
        </div>

        <div className="compactTilesGrid" style={{ marginTop: 14 }}>
          {tileCards}
        </div>

        {view !== 'team' ? (
          <div className="small" style={{ marginTop: 10 }}>
            Handicap is calculated from the current filtered solo rounds shown on this page.
          </div>
        ) : null}

        {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}
        {error ? <div className="small" style={{ marginTop: 12, color: 'crimson' }}>{error}</div> : null}

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16, gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Most Recent 10 Logged Events</h3>
          {!user ? <Link className="small" to="/login">Log in to save rounds</Link> : view === 'team' ? <Link className="small" to="/golf-logger">Log a team round</Link> : view === 'solo' ? <Link className="small" to="/solo-logger">Log a solo round</Link> : <Link className="small" to="/my-golf-scores">Open My Golf Scores</Link>}
        </div>

        <div className="roundRowsStack" style={{ marginTop: 12 }}>
          {recentRounds.map((round) => <RoundRow key={round.id} round={round} onClick={() => setSelectedRound(round)} />)}
          {!recentRounds.length ? <div className="small">No rounds yet for this view and filters.</div> : null}
        </div>
      </div>

      <RoundDetailModal round={selectedRound} allScores={filteredScores} onClose={() => setSelectedRound(null)} />
      <HandicapBreakdownModal open={showHandicapModal} stats={handicapStats} onClose={() => setShowHandicapModal(false)} />
    </div>
  )
}
