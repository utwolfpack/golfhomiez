import { isValidPastOrTodayDate } from './validation.js'

export function calculateTeamMatchSummary(teamTotal, opponentTotal) {
  const won = teamTotal < opponentTotal ? true : (teamTotal > opponentTotal ? false : null)
  const diff = Math.abs(opponentTotal - teamTotal)
  const money = won === true ? diff : won === false ? -diff : 0
  return { won, money }
}

export function validateSoloScorePayload(body = {}) {
  const { date, state, course, roundScore, holes } = body
  if (!date || !course) return { ok: false, message: 'date and course required' }
  if (!isValidPastOrTodayDate(date)) return { ok: false, message: 'Date must be today or earlier' }
  if (!state || typeof state !== 'string' || !String(state).trim()) return { ok: false, message: 'state required' }
  if (typeof roundScore !== 'number' || Number.isNaN(roundScore)) return { ok: false, message: 'roundScore must be a number' }
  if (roundScore < 0) return { ok: false, message: 'roundScore must be zero or greater' }

  return {
    ok: true,
    data: {
      mode: 'solo',
      date,
      state: String(state).toUpperCase(),
      course,
      roundScore,
      holes: Array.isArray(holes) ? holes : null,
    },
  }
}

export function validateTeamScorePayload(body = {}) {
  const { date, state, course, team, opponentTeam, teamTotal, opponentTotal, holes } = body
  if (!date || !course || !team) return { ok: false, message: 'date, course, team required' }
  if (!isValidPastOrTodayDate(date)) return { ok: false, message: 'Date must be today or earlier' }
  if (!state || typeof state !== 'string' || !String(state).trim()) return { ok: false, message: 'state required' }
  if (!opponentTeam || !String(opponentTeam).trim()) return { ok: false, message: 'opponentTeam required' }
  if (String(opponentTeam).trim().toLowerCase() === String(team).trim().toLowerCase()) {
    return { ok: false, message: 'Opponent team must be different from your team' }
  }
  if (typeof teamTotal !== 'number' || Number.isNaN(teamTotal)) return { ok: false, message: 'teamTotal must be a number' }
  if (typeof opponentTotal !== 'number' || Number.isNaN(opponentTotal)) return { ok: false, message: 'opponentTotal must be a number' }
  if (teamTotal < 0 || opponentTotal < 0) return { ok: false, message: 'Scores must be zero or greater' }

  return {
    ok: true,
    data: {
      mode: 'team',
      date,
      state: String(state).toUpperCase(),
      course,
      team,
      opponentTeam: String(opponentTeam).trim(),
      teamTotal,
      opponentTotal,
      holes: Array.isArray(holes) ? holes : null,
      ...calculateTeamMatchSummary(teamTotal, opponentTotal),
    },
  }
}
