import crypto from 'node:crypto'

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function cleanState(value) {
  return cleanText(value).toUpperCase()
}

function cleanMode(value) {
  return value === 'solo' ? 'solo' : 'team'
}

function cleanNullable(value) {
  const text = cleanText(value)
  return text || null
}

function teamKey(value) {
  return cleanText(value).toLowerCase()
}

function cleanScoringSide(value) {
  const side = cleanText(value).toLowerCase()
  return side === 'opponent' ? 'opponent' : 'team'
}

export function buildScorecardDraftId(context, holeNumber) {
  const rawKey = JSON.stringify([
    context.userId,
    context.mode,
    context.scoringSide,
    context.date,
    context.state,
    context.course,
    context.teamKey,
    context.opponentTeamKey,
    Number(holeNumber),
  ])
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

export function normalizeDraftContext(input = {}, user = {}) {
  const mode = cleanMode(input.mode)
  const date = cleanText(input.date)
  const state = cleanState(input.state)
  const course = cleanText(input.course)
  if (!date) throw new Error('date required')
  if (!state) throw new Error('state required')
  if (!course) throw new Error('course required')
  if (!user?.id) throw new Error('authenticated user required')

  const team = mode === 'team' ? cleanNullable(input.team) : null
  const opponentTeam = mode === 'team' ? cleanNullable(input.opponentTeam ?? input.opponent_team) : null
  const scoringSide = cleanScoringSide(input.scoringSide ?? input.scorecardSide ?? input.scoring_side ?? input.side)

  return {
    userId: user.id,
    userEmail: cleanText(user.email),
    mode,
    date,
    state,
    course,
    team,
    opponentTeam,
    scoringSide,
    teamKey: teamKey(team),
    opponentTeamKey: teamKey(opponentTeam),
  }
}

export function normalizeDraftHole(input = {}) {
  const record = input && typeof input === 'object' && 'hole' in input && typeof input.hole === 'object'
    ? input.hole
    : input
  const holeNumber = Number(record.hole ?? record.holeNumber ?? record.hole_number)
  const par = Number(record.par)
  const yards = Number(record.yards)
  const strokeIndex = Number(record.strokeIndex ?? record.stroke_index)
  const score = Number(record.score)

  if (!Number.isFinite(holeNumber) || holeNumber < 1 || holeNumber > 18) throw new Error('hole must be between 1 and 18')
  if (!Number.isFinite(score) || score < 0) throw new Error('score must be zero or greater')

  return {
    hole: Math.trunc(holeNumber),
    par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : null,
    yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : null,
    strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : Math.trunc(holeNumber),
    score: Math.max(0, Math.trunc(score)),
    scoreProvided: true,
  }
}

export function mapDraftHole(row = {}) {
  return {
    hole: Number(row.hole_number),
    par: row.par == null ? null : Number(row.par),
    yards: row.yards == null ? null : Number(row.yards),
    strokeIndex: row.stroke_index == null ? Number(row.hole_number) : Number(row.stroke_index),
    score: Number(row.score),
    scoreProvided: Boolean(row.score_provided),
    updatedAt: row.updated_at || row.created_at || null,
  }
}

export async function listScorecardDraftHoles(db, context) {
  const [rows] = await db.execute(
    `SELECT hole_number, par, yards, stroke_index, score, score_provided, created_at, updated_at
       FROM scorecard_hole_drafts
      WHERE created_by_user_id = ?
        AND mode = ?
        AND scoring_side = ?
        AND date = ?
        AND state = ?
        AND course = ?
        AND team_key = ?
        AND opponent_team_key = ?
      ORDER BY hole_number ASC`,
    [
      context.userId,
      context.mode,
      context.scoringSide,
      context.date,
      context.state,
      context.course,
      context.teamKey,
      context.opponentTeamKey,
    ],
  )
  return rows.map(mapDraftHole)
}

export async function upsertScorecardDraftHole(db, context, hole) {
  const id = buildScorecardDraftId(context, hole.hole)
  await db.execute(
    `INSERT INTO scorecard_hole_drafts (
       id, created_by_user_id, created_by_email, mode, scoring_side, date, state, course,
       team, opponent_team, team_key, opponent_team_key,
       hole_number, par, yards, stroke_index, score, score_provided, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       created_by_email = VALUES(created_by_email),
       team = VALUES(team),
       opponent_team = VALUES(opponent_team),
       par = VALUES(par),
       yards = VALUES(yards),
       stroke_index = VALUES(stroke_index),
       score = VALUES(score),
       score_provided = 1,
       updated_at = CURRENT_TIMESTAMP`,
    [
      id,
      context.userId,
      context.userEmail,
      context.mode,
      context.scoringSide,
      context.date,
      context.state,
      context.course,
      context.team,
      context.opponentTeam,
      context.teamKey,
      context.opponentTeamKey,
      hole.hole,
      hole.par,
      hole.yards,
      hole.strokeIndex,
      hole.score,
    ],
  )
  return { ...hole, scoreProvided: true }
}

export async function clearScorecardDraftHoles(db, context) {
  const [result] = await db.execute(
    `DELETE FROM scorecard_hole_drafts
      WHERE created_by_user_id = ?
        AND mode = ?
        AND scoring_side = ?
        AND date = ?
        AND state = ?
        AND course = ?
        AND team_key = ?
        AND opponent_team_key = ?`,
    [
      context.userId,
      context.mode,
      context.scoringSide,
      context.date,
      context.state,
      context.course,
      context.teamKey,
      context.opponentTeamKey,
    ],
  )
  return Number(result?.affectedRows || 0)
}
