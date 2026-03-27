import { v4 as uuidv4 } from 'uuid'
import { initDb, getPool } from '../db.js'
import { runAuthMigrations } from '../auth-migrations.js'
import { runAppMigrations } from '../migrations/runner.js'

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase()
}

function toIso(value) {
  if (!value) return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

function mapTeam(rows, memberRows) {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: toIso(row.created_at),
    members: memberRows
      .filter((m) => m.team_id === row.id)
      .map((m) => ({ id: m.id, name: m.name, email: m.email })),
  }))
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
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdAt: toIso(row.created_at),
  }
}

export async function initStorage() {
  await initDb()
  await runAuthMigrations()
  await runAppMigrations(getPool())
}

export async function getBackendName() {
  return 'mysql'
}

export async function listTeams() {
  const db = getPool()
  const [teamRows] = await db.query('SELECT * FROM teams ORDER BY name ASC')
  const [memberRows] = await db.query('SELECT * FROM team_members ORDER BY name ASC')
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
  const [memberRows] = await db.execute('SELECT * FROM team_members WHERE team_id = ? ORDER BY name ASC', [row.id])
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
        [member.id, team.id, member.name, normalizeEmail(member.email)]
      )
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return team
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
        [member.id, id, member.name, normalizeEmail(member.email)]
      )
    }
    if (existing.name !== String(name).trim()) {
      await conn.execute('UPDATE scores SET team = ? WHERE team = ?', [String(name).trim(), existing.name])
      await conn.execute('UPDATE scores SET opponent_team = ? WHERE opponent_team = ?', [String(name).trim(), existing.name])
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return getTeamById(id)
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
  const score = {
    id: uuidv4(),
    ...entry,
    createdAt: new Date().toISOString(),
  }
  await db.execute(
    `INSERT INTO scores (
      id, mode, date, state, course, team, opponent_team,
      team_total, opponent_total, round_score, money, won,
      holes_json, created_by_user_id, created_by_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
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
      score.createdByUserId,
      score.createdByEmail,
    ]
  )
  return score
}

export async function deleteScoreById(id) {
  const db = getPool()
  await db.execute('DELETE FROM scores WHERE id = ?', [id])
}
