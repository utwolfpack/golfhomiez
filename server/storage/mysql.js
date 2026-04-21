import { v4 as uuidv4 } from 'uuid'
import { initDb, getPool } from '../db.js'
import { logError, logInfo } from '../lib/logger.js'
import { getGolfCourseByName } from '../lib/golf-course-service.js'

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase()
}

function toIso(value) {
  if (!value) return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

function mapMember(row) {
  const verified = row.user_email_verified == null ? null : Boolean(row.user_email_verified)
  const status = verified === true ? 'active' : 'pending_verification'
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status,
    verified: verified === true,
  }
}

function mapTeam(rows, memberRows) {
  return rows.map((row) => {
    const members = memberRows
      .filter((m) => m.team_id === row.id)
      .map(mapMember)

    return {
      id: row.id,
      name: row.name,
      createdAt: toIso(row.created_at),
      members,
      hasPendingMembers: members.some((member) => member.status !== 'active'),
    }
  })
}

function mapScore(row) {
  return {
    id: row.id,
    mode: row.mode,
    date: typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().slice(0, 10),
    state: row.state,
    course: row.course,
    team: row.team,
    opponentTeam: row.opponent_team,
    teamTotal: row.team_total,
    opponentTotal: row.opponent_total,
    roundScore: row.round_score,
    money: row.money == null ? null : Number(row.money),
    won: row.won == null ? null : Boolean(row.won),
    holes: row.holes_json ? (typeof row.holes_json === 'string' ? JSON.parse(row.holes_json) : row.holes_json) : null,
    golfCourseId: row.golf_course_id || null,
    courseRating: row.course_rating == null ? null : Number(row.course_rating),
    slopeRating: row.slope_rating == null ? null : Number(row.slope_rating),
    coursePar: row.course_par == null ? null : Number(row.course_par),
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdAt: toIso(row.created_at),
  }
}

export async function initStorage() {
  await initDb()
  logInfo('MySQL storage initialized')
}

export async function getBackendName() {
  return 'mysql'
}

async function fetchTeamMembers(db, teamId) {
  if (teamId) {
    const [rows] = await db.execute(
      `SELECT tm.*, u.emailVerified AS user_email_verified
         FROM team_members tm
         LEFT JOIN \`user\` u ON LOWER(u.email) = LOWER(tm.email)
        WHERE tm.team_id = ?
        ORDER BY tm.name ASC`,
      [teamId],
    )
    return rows
  }

  const [rows] = await db.query(
    `SELECT tm.*, u.emailVerified AS user_email_verified
       FROM team_members tm
       LEFT JOIN \`user\` u ON LOWER(u.email) = LOWER(tm.email)
      ORDER BY tm.name ASC`,
  )
  return rows
}

export async function listTeams() {
  const db = getPool()
  const [teamRows] = await db.query('SELECT * FROM teams ORDER BY name ASC')
  const memberRows = await fetchTeamMembers(db)
  return mapTeam(teamRows, memberRows)
}

export async function getTeamById(id) {
  const teams = await listTeams()
  return teams.find((t) => t.id === String(id)) || null
}

export async function getTeamByName(name) {
  const db = getPool()
  const [rows] = await db.execute('SELECT * FROM teams WHERE LOWER(name) = LOWER(?) LIMIT 1', [String(name || '').trim()])
  const row = rows[0]
  if (!row) return null
  const memberRows = await fetchTeamMembers(db, row.id)
  return mapTeam([row], memberRows)[0] || null
}

export async function createTeam({ name, members }) {
  const db = getPool()
  const team = { id: uuidv4(), name: String(name).trim(), members, createdAt: new Date().toISOString() }
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute('INSERT INTO teams (id, name, created_at) VALUES (?, ?, NOW())', [team.id, team.name])
    for (const member of members) {
      await conn.execute(
        'INSERT INTO team_members (id, team_id, name, email) VALUES (?, ?, ?, ?)',
        [member.id, team.id, member.name, normalizeEmail(member.email)],
      )
    }
    await conn.commit()
    logInfo('Created team', { teamId: team.id, teamName: team.name, memberCount: members.length })
    return getTeamById(team.id)
  } catch (error) {
    await conn.rollback()
    logError('Failed to create team in MySQL storage', { error, teamName: team.name })
    throw error
  } finally {
    conn.release()
  }
}

export async function updateTeam(id, { name, members }) {
  const db = getPool()
  const existing = await getTeamById(id)
  if (!existing) return null

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute('UPDATE teams SET name = ? WHERE id = ?', [String(name).trim(), id])
    await conn.execute('DELETE FROM team_members WHERE team_id = ?', [id])
    for (const member of members) {
      await conn.execute(
        'INSERT INTO team_members (id, team_id, name, email) VALUES (?, ?, ?, ?)',
        [member.id, id, member.name, normalizeEmail(member.email)],
      )
    }
    if (existing.name !== String(name).trim()) {
      await conn.execute('UPDATE scores SET team = ? WHERE team = ?', [String(name).trim(), existing.name])
      await conn.execute('UPDATE scores SET opponent_team = ? WHERE opponent_team = ?', [String(name).trim(), existing.name])
    }
    await conn.commit()
    logInfo('Updated team', { teamId: id, teamName: String(name).trim(), memberCount: members.length })
    return getTeamById(id)
  } catch (error) {
    await conn.rollback()
    logError('Failed to update team in MySQL storage', { error, teamId: id, teamName: String(name).trim() })
    throw error
  } finally {
    conn.release()
  }
}

export async function findUserByEmail(email) {
  const db = getPool()
  const normalized = normalizeEmail(email)
  const [rows] = await db.execute(
    'SELECT id, email, name, emailVerified FROM `user` WHERE LOWER(email) = ? LIMIT 1',
    [normalized],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: Boolean(row.emailVerified),
  }
}

export async function listScores() {
  const db = getPool()
  const [rows] = await db.query('SELECT * FROM scores ORDER BY created_at DESC')
  return rows.map(mapScore)
}

export async function getScoreById(id) {
  const db = getPool()
  const [rows] = await db.execute('SELECT * FROM scores WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapScore(rows[0]) : null
}

export async function createScore(entry) {
  const db = getPool()
  const resolvedCourse = await getGolfCourseByName({ state: entry.state, name: entry.course })
  const score = {
    id: uuidv4(),
    ...entry,
    golfCourseId: resolvedCourse?.id || null,
    courseRating: entry.courseRating ?? null,
    slopeRating: entry.slopeRating ?? null,
    coursePar: entry.coursePar ?? resolvedCourse?.parTotal ?? null,
    createdAt: new Date().toISOString(),
  }
  try {
    await db.execute(
      `INSERT INTO scores (
        id, mode, date, state, course, team, opponent_team,
        team_total, opponent_total, round_score, money, won,
        holes_json, golf_course_id, course_rating, slope_rating, course_par,
        created_by_user_id, created_by_email, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        score.id,
        score.mode,
        score.date,
        score.state,
        score.course,
        score.team ?? null,
        score.opponentTeam ?? null,
        score.teamTotal ?? null,
        score.opponentTotal ?? null,
        score.roundScore ?? null,
        score.money ?? null,
        score.won === true ? 1 : score.won === false ? 0 : null,
        score.holes ? JSON.stringify(score.holes) : null,
        score.golfCourseId,
        score.courseRating ?? null,
        score.slopeRating ?? null,
        score.coursePar ?? null,
        score.createdByUserId,
        score.createdByEmail,
      ],
    )
    logInfo('Created score', { scoreId: score.id, mode: score.mode, golfCourseId: score.golfCourseId, createdByUserId: score.createdByUserId, createdByEmail: score.createdByEmail })
    return score
  } catch (error) {
    logError('Failed to create score in MySQL storage', { error, scoreId: score.id, mode: score.mode, golfCourseId: score.golfCourseId, createdByUserId: score.createdByUserId, createdByEmail: score.createdByEmail })
    throw error
  }
}

export async function deleteScoreById(id) {
  const db = getPool()
  try {
    await db.execute('DELETE FROM scores WHERE id = ?', [id])
    logInfo('Deleted score', { scoreId: id })
  } catch (error) {
    logError('Failed to delete score in MySQL storage', { error, scoreId: id })
    throw error
  }
}
