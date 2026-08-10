import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTournamentFinalLeaderboardRows } from '../server/lib/tournament-final-leaderboard.js'

test('final tournament leaderboard ranks registered teams by relative score then total strokes', () => {
  const registrations = [
    { id: 'reg-1', teamId: 'alpha', teamName: 'Alpha Team' },
    { id: 'reg-2', teamId: 'beta', teamName: 'Beta Team' },
    { id: 'reg-3', teamId: 'gamma', teamName: 'Gamma Team' },
  ]
  const holes = (scores) => scores.map((score, index) => ({ hole: index + 1, par: 4, score, scoreProvided: true }))
  const rows = buildTournamentFinalLeaderboardRows(registrations, [
    { team_key: 'team:alpha', team_name: 'Alpha Team', total_score: 70, holes_json: JSON.stringify(holes([3, 4, 4, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4])) },
    { team_key: 'team:beta', team_name: 'Beta Team', total_score: 68, holes_json: JSON.stringify(holes([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3])) },
  ])

  assert.equal(rows.length, 3)
  assert.equal(rows[0].teamName, 'Beta Team')
  assert.equal(rows[0].position, 1)
  assert.equal(rows[0].roundLabel, '-4')
  assert.equal(rows[0].holesCompleted, 18)
  assert.equal(rows[1].teamName, 'Alpha Team')
  assert.equal(rows[1].roundLabel, '-2')
  assert.equal(rows[2].teamName, 'Gamma Team')
  assert.equal(rows[2].totalScore, null)
  assert.equal(rows[2].roundLabel, '—')
})

test('final tournament leaderboard supports name-keyed registrations and partial scorecards', () => {
  const rows = buildTournamentFinalLeaderboardRows(
    [{ id: 'reg-1', teamName: 'Weekend Warriors' }],
    [{ team_key: 'name:weekend warriors', team_name: 'Weekend Warriors', holes_json: JSON.stringify([
      { hole: 1, par: 4, score: 4, scoreProvided: true },
      { hole: 2, par: 5, score: 4, scoreProvided: true },
      { hole: 3, par: 3, score: null, scoreProvided: false },
    ]) }],
  )

  assert.equal(rows[0].totalScore, 8)
  assert.equal(rows[0].roundLabel, '-1')
  assert.equal(rows[0].holesCompleted, 2)
  assert.equal(rows[0].thru, 2)
})
