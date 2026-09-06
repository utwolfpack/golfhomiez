function normalizeTeamKey(registration = {}) {
  const teamId = String(registration.teamId || registration.team_id || '').trim()
  if (teamId) return `team:${teamId}`
  const teamName = String(registration.teamName || registration.team_name || '').trim().toLowerCase()
  if (teamName) return `name:${teamName}`
  return `registration:${registration.id}`
}


function normalizeTeamMemberNames(registration = {}) {
  const names = []
  const seen = new Set()
  for (const member of Array.isArray(registration.teamMembers || registration.team_members) ? (registration.teamMembers || registration.team_members) : []) {
    const name = String(member?.name || '').replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function parseScoreHoles(value) {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function providedHoleRows(holes = []) {
  return (Array.isArray(holes) ? holes : []).filter((hole) => {
    const score = Number(hole?.score)
    return hole?.scoreProvided === true && Number.isFinite(score)
  })
}

function relativeLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const normalized = Number(value)
  if (normalized === 0) return 'E'
  return normalized > 0 ? `+${normalized}` : String(normalized)
}

function normalizeScoreRow(row = {}) {
  const holes = parseScoreHoles(row.holes_json ?? row.holes)
  const entered = providedHoleRows(holes)
  const storedTotal = row.total_score ?? row.totalScore
  const totalScore = storedTotal == null
    ? (entered.length ? entered.reduce((sum, hole) => sum + Number(hole.score), 0) : null)
    : Number(storedTotal)
  const par = entered.reduce((sum, hole) => {
    const value = Number(hole?.par)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
  const relativeToPar = totalScore == null || !entered.length || !Number.isFinite(totalScore)
    ? null
    : totalScore - par
  const thru = entered.length
    ? Math.max(...entered.map((hole) => Number(hole?.hole) || 0))
    : null

  return {
    teamKey: String(row.team_key ?? row.teamKey ?? ''),
    teamId: row.team_id ?? row.teamId ?? null,
    teamName: String(row.team_name ?? row.teamName ?? '').trim() || 'Tournament team',
    totalScore: Number.isFinite(totalScore) ? totalScore : null,
    relativeToPar,
    roundLabel: relativeLabel(relativeToPar),
    holesCompleted: entered.length,
    holes: entered.map((hole, index) => ({
      hole: Number(hole?.hole) || index + 1,
      par: Number.isFinite(Number(hole?.par)) ? Number(hole.par) : null,
      score: Number.isFinite(Number(hole?.score)) ? Number(hole.score) : null,
      scoreProvided: true,
    })),
    thru,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  }
}

export function buildTournamentFinalLeaderboardRows(registrations = [], scoreRows = []) {
  const scoresByTeamKey = new Map(
    (Array.isArray(scoreRows) ? scoreRows : []).map((row) => {
      const normalized = normalizeScoreRow(row)
      return [normalized.teamKey, normalized]
    }),
  )

  const rows = (Array.isArray(registrations) ? registrations : []).map((registration) => {
    const teamKey = normalizeTeamKey(registration)
    const score = scoresByTeamKey.get(teamKey) || null
    return {
      position: 0,
      teamKey,
      teamId: registration.teamId || registration.team_id || score?.teamId || null,
      teamName: String(registration.teamName || registration.team_name || score?.teamName || registration.name || '').trim() || 'Tournament team',
      teamMemberNames: normalizeTeamMemberNames(registration),
      totalScore: score?.totalScore ?? null,
      relativeToPar: score?.relativeToPar ?? null,
      roundLabel: score?.roundLabel || '—',
      holesCompleted: score?.holesCompleted ?? 0,
      holes: score?.holes || [],
      thru: score?.thru ?? null,
      updatedAt: score?.updatedAt || null,
    }
  })

  rows.sort((left, right) => {
    const leftRelative = left.relativeToPar == null ? Number.POSITIVE_INFINITY : Number(left.relativeToPar)
    const rightRelative = right.relativeToPar == null ? Number.POSITIVE_INFINITY : Number(right.relativeToPar)
    const leftTotal = left.totalScore == null ? Number.POSITIVE_INFINITY : Number(left.totalScore)
    const rightTotal = right.totalScore == null ? Number.POSITIVE_INFINITY : Number(right.totalScore)
    return leftRelative - rightRelative
      || leftTotal - rightTotal
      || left.teamName.localeCompare(right.teamName)
  })

  return rows.map((row, index) => ({ ...row, position: index + 1 }))
}

export async function loadTournamentFinalLeaderboard(pool, tournamentId, registrations = []) {
  const [scoreRows] = await pool.execute(
    `SELECT id, tournament_id, team_key, team_id, team_name, total_score, holes_json, tee_color, updated_at
       FROM tournament_team_scores
      WHERE tournament_id = ?`,
    [tournamentId],
  )
  return buildTournamentFinalLeaderboardRows(registrations, scoreRows)
}

export function buildTournamentLiveLeaderboardRows(registrations = [], scoreRows = []) {
  return buildTournamentFinalLeaderboardRows(registrations, scoreRows).map((row) => ({
    position: row.position,
    teamKey: row.teamKey,
    teamId: row.teamId,
    teamName: row.teamName,
    totalScore: row.totalScore,
    relativeToPar: row.relativeToPar,
    roundLabel: row.relativeToPar === 0 ? 'Par' : row.roundLabel,
    holesCompleted: row.holesCompleted,
    thru: row.thru,
    updatedAt: row.updatedAt,
  }))
}

export async function loadTournamentLiveLeaderboard(pool, tournamentId, registrations = []) {
  const [scoreRows] = await pool.execute(
    `SELECT id, tournament_id, team_key, team_id, team_name, total_score, holes_json, tee_color, updated_at
       FROM tournament_team_scores
      WHERE tournament_id = ?`,
    [tournamentId],
  )
  return buildTournamentLiveLeaderboardRows(registrations, scoreRows)
}
