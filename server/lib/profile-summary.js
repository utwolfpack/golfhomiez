function readFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}


function parseScoreHoles(value) {
  if (!value) return null
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

function holeScoreProvided(hole) {
  if (!hole || typeof hole !== 'object') return false
  const provided = hole.scoreProvided ?? hole.score_provided
  if (provided === false || provided === 0 || provided === '0' || provided === 'false') return false
  if (provided === true || provided === 1 || provided === '1' || provided === 'true') return true
  const score = Number(hole.score)
  return Number.isFinite(score) && score >= 0
}

function expectedRoundHoleCount(score, holes) {
  const explicit = Number(score?.courseHoleCount ?? score?.course_hole_count ?? score?.holesCount ?? score?.holes_count)
  if (Number.isFinite(explicit) && explicit > 0 && explicit <= 18) return Math.trunc(explicit)

  const coursePar = Number(score?.coursePar ?? score?.course_par ?? score?.parTotal ?? score?.par_total)
  const highestHole = Array.isArray(holes)
    ? holes.reduce((maxHole, hole, index) => {
        const holeNumber = typeof hole === 'object' && hole
          ? Number(hole.hole ?? hole.holeNumber ?? hole.hole_number ?? index + 1)
          : index + 1
        return Number.isFinite(holeNumber) && holeNumber > 0 ? Math.max(maxHole, Math.trunc(holeNumber)) : maxHole
      }, 0)
    : 0

  if (highestHole > 9) return Math.min(18, highestHole)
  if (Number.isFinite(coursePar) && coursePar > 0) {
    if (coursePar <= 45 && highestHole <= 9) return 9
    if (coursePar > 45) return 18
  }
  if (holes?.length >= 18) return 18
  return 18
}

function isCompleteRound(score) {
  const holes = parseScoreHoles(score?.holes ?? score?.holes_json)
  if (!holes || holes.length === 0) return scoreValue(score) != null
  const providedCount = holes.filter(holeScoreProvided).length
  return providedCount >= expectedRoundHoleCount(score, holes)
}

function normalizedMode(score) {
  return score?.mode === 'solo' ? 'solo' : 'team'
}

function scoreValue(score) {
  if (normalizedMode(score) === 'solo') return readFiniteNumber(score?.roundScore ?? score?.round_score)
  return readFiniteNumber(score?.teamTotal ?? score?.team_total)
}

function displayDate(score) {
  const value = score?.date
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  try {
    return new Date(value).toISOString().slice(0, 10)
  } catch {
    return String(value).slice(0, 10)
  }
}

function calculateHandicapDifferential(score, courseRating, slopeRating) {
  if (!Number.isFinite(score) || !Number.isFinite(courseRating) || !Number.isFinite(slopeRating) || slopeRating <= 0) return null
  return Math.round((((score - courseRating) * 113) / slopeRating) * 10) / 10
}

function resolveHandicapRule(ratedRounds) {
  if (ratedRounds < 3) return { usedCount: 0, adjustment: 0 }
  if (ratedRounds === 3) return { usedCount: 1, adjustment: -2 }
  if (ratedRounds === 4) return { usedCount: 1, adjustment: -1 }
  if (ratedRounds === 5) return { usedCount: 1, adjustment: 0 }
  if (ratedRounds === 6) return { usedCount: 2, adjustment: -1 }
  if (ratedRounds <= 8) return { usedCount: 2, adjustment: 0 }
  if (ratedRounds <= 11) return { usedCount: 3, adjustment: 0 }
  if (ratedRounds <= 14) return { usedCount: 4, adjustment: 0 }
  if (ratedRounds <= 16) return { usedCount: 5, adjustment: 0 }
  if (ratedRounds <= 18) return { usedCount: 6, adjustment: 0 }
  if (ratedRounds === 19) return { usedCount: 7, adjustment: 0 }
  return { usedCount: 8, adjustment: 0 }
}

export function calculateProfileHandicap(scores = []) {
  const differentials = scores
    .filter((score) => normalizedMode(score) === 'solo')
    .sort((a, b) => String(displayDate(b)).localeCompare(String(displayDate(a))) || String(b?.createdAt || b?.created_at || '').localeCompare(String(a?.createdAt || a?.created_at || '')))
    .slice(0, 20)
    .map((score) => {
      const roundScore = readFiniteNumber(score?.roundScore ?? score?.round_score)
      const courseRating = readFiniteNumber(score?.courseRating ?? score?.course_rating)
      const slopeRating = readFiniteNumber(score?.slopeRating ?? score?.slope_rating)
      if (roundScore == null || courseRating == null || slopeRating == null) return null
      return calculateHandicapDifferential(roundScore, courseRating, slopeRating)
    })
    .filter((value) => value != null)
    .sort((a, b) => a - b)

  const rule = resolveHandicapRule(differentials.length)
  if (!rule.usedCount) {
    return {
      handicap: null,
      ratedRounds: differentials.length,
      roundsUsed: 0,
      message: differentials.length ? `Need at least 3 rated solo rounds. ${differentials.length} available.` : 'No rated solo rounds available yet.',
    }
  }

  const used = differentials.slice(0, rule.usedCount)
  const average = used.reduce((sum, value) => sum + value, 0) / used.length
  const handicap = Math.max(0, Math.round((average + rule.adjustment) * 10) / 10)
  return {
    handicap,
    ratedRounds: differentials.length,
    roundsUsed: rule.usedCount,
    message: `Using ${rule.usedCount} of ${differentials.length} rated solo round${differentials.length === 1 ? '' : 's'}.`,
  }
}

export function buildProfileSummaryFromScores(scores = []) {
  const rounds = scores.filter((score) => score && (normalizedMode(score) === 'solo' || normalizedMode(score) === 'team'))
  const soloRounds = rounds.filter((score) => normalizedMode(score) === 'solo')
  const teamRounds = rounds.filter((score) => normalizedMode(score) === 'team')
  const courseCounts = new Map()

  for (const score of rounds) {
    const course = String(score?.course || '').trim()
    if (!course) continue
    const key = course.toLowerCase()
    const current = courseCounts.get(key) || { course, count: 0 }
    current.count += 1
    courseCounts.set(key, current)
  }

  const mostPlayedCourse = [...courseCounts.values()]
    .sort((a, b) => b.count - a.count || a.course.localeCompare(b.course))[0] || null

  const bestScore = rounds
    .filter(isCompleteRound)
    .map((score) => ({
      score: scoreValue(score),
      mode: normalizedMode(score),
      course: String(score?.course || ''),
      date: displayDate(score),
    }))
    .filter((entry) => entry.score != null)
    .sort((a, b) => a.score - b.score || String(b.date).localeCompare(String(a.date)))[0] || null

  const handicap = calculateProfileHandicap(rounds)

  return {
    roundsGolfed: rounds.length,
    eventTypes: {
      individual: soloRounds.length,
      team: teamRounds.length,
    },
    mostPlayedCourse,
    handicap,
    bestScore,
  }
}

function mapScoreRow(row) {
  return {
    id: row.id,
    mode: row.mode,
    date: displayDate(row),
    course: row.course || '',
    roundScore: row.round_score == null ? null : Number(row.round_score),
    teamTotal: row.team_total == null ? null : Number(row.team_total),
    holes: parseScoreHoles(row.holes_json),
    courseRating: row.course_rating == null ? null : Number(row.course_rating),
    slopeRating: row.slope_rating == null ? null : Number(row.slope_rating),
    coursePar: row.course_par == null ? null : Number(row.course_par),
    createdAt: row.created_at || null,
  }
}

export async function loadProfileSummary(db, user) {
  const email = String(user?.email || '').trim().toLowerCase()
  const [rows] = await db.execute(
    `SELECT id, mode, date, course, round_score, team_total, holes_json, course_rating, slope_rating, course_par, created_at
       FROM scores
      WHERE created_by_user_id = ? OR LOWER(created_by_email) = LOWER(?)
      ORDER BY date DESC, created_at DESC`,
    [user?.id || '', email],
  )
  return buildProfileSummaryFromScores((rows || []).map(mapScoreRow))
}
