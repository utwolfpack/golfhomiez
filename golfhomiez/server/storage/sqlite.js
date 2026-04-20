import { v4 as uuidv4 } from 'uuid'
import { initDb, getSqliteDb } from '../db.js'

function toIso(value) {
  if (!value) return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

function mapTeamRow(row, memberRows) {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIso(row.created_at),
    members: memberRows
      .filter((member) => member.team_id === row.id)
      .map((member) => ({ id: member.id, name: member.name, email: member.email })),
  }
}

function mapScoreRow(row) {
  return {
    id: row.id,
    mode: row.mode,
    date: row.date,
    state: row.state,
    course: row.course,
    team: row.team,
    opponentTeam: row.opponent_team,
    teamTotal: row.team_total,
    opponentTotal: row.opponent_total,
    roundScore: row.round_score,
    money: row.money == null ? null : Number(row.money),
    won: row.won == null ? null : Boolean(row.won),
    holes: row.holes_json ? JSON.parse(row.holes_json) : null,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdAt: toIso(row.created_at),
  }
}

export async function initStorage() {
  await initDb()
}

export async function getBackendName() {
  return 'sqlite'
}

export async function listTeams() {
  const db = getSqliteDb()
  const teamRows = db.prepare('SELECT * FROM teams ORDER BY name ASC').all()
  const memberRows = db.prepare('SELECT * FROM team_members ORDER BY name ASC').all()
  return teamRows.map((row) => mapTeamRow(row, memberRows))
}

export async function getTeamById(id) {
  const db = getSqliteDb()
  const row = db.prepare('SELECT * FROM teams WHERE id = ? LIMIT 1').get(String(id))
  if (!row) return null
  const memberRows = db.prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY name ASC').all(String(id))
  return mapTeamRow(row, memberRows)
}

export async function getTeamByName(name) {
  const db = getSqliteDb()
  const row = db.prepare('SELECT * FROM teams WHERE lower(name) = lower(?) LIMIT 1').get(String(name || '').trim())
  if (!row) return null
  const memberRows = db.prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY name ASC').all(row.id)
  return mapTeamRow(row, memberRows)
}

export async function createTeam({ name, members }) {
  const db = getSqliteDb()
  const team = { id: uuidv4(), name: String(name).trim(), members, createdAt: new Date().toISOString() }
  const insertTeam = db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)')
  const insertMember = db.prepare('INSERT INTO team_members (id, team_id, name, email) VALUES (?, ?, ?, ?)')

  const transaction = db.transaction(() => {
    insertTeam.run(team.id, team.name, team.createdAt)
    for (const member of members) {
      insertMember.run(member.id, team.id, member.name, member.email)
    }
  })

  transaction()
  return team
}

export async function updateTeam(id, { name, members }) {
  const db = getSqliteDb()
  const existing = await getTeamById(id)
  if (!existing) return null

  const updateTeamStmt = db.prepare('UPDATE teams SET name = ? WHERE id = ?')
  const deleteMembersStmt = db.prepare('DELETE FROM team_members WHERE team_id = ?')
  const insertMemberStmt = db.prepare('INSERT INTO team_members (id, team_id, name, email) VALUES (?, ?, ?, ?)')
  const updateTeamScoresStmt = db.prepare('UPDATE scores SET team = ? WHERE team = ?')
  const updateOpponentScoresStmt = db.prepare('UPDATE scores SET opponent_team = ? WHERE opponent_team = ?')

  const transaction = db.transaction(() => {
    updateTeamStmt.run(String(name).trim(), id)
    deleteMembersStmt.run(id)
    for (const member of members) {
      insertMemberStmt.run(member.id, id, member.name, member.email)
    }
    if (existing.name !== String(name).trim()) {
      updateTeamScoresStmt.run(String(name).trim(), existing.name)
      updateOpponentScoresStmt.run(String(name).trim(), existing.name)
    }
  })

  transaction()
  return getTeamById(id)
}

export async function listScores() {
  const db = getSqliteDb()
  const rows = db.prepare('SELECT * FROM scores ORDER BY created_at DESC').all()
  return rows.map(mapScoreRow)
}

export async function getScoreById(id) {
  const db = getSqliteDb()
  const row = db.prepare('SELECT * FROM scores WHERE id = ? LIMIT 1').get(String(id))
  return row ? mapScoreRow(row) : null
}

export async function createScore(entry) {
  const db = getSqliteDb()
  const score = { id: uuidv4(), ...entry, createdAt: new Date().toISOString() }

  db.prepare(`
    INSERT INTO scores (
      id, mode, date, state, course, team, opponent_team,
      team_total, opponent_total, round_score, money, won,
      holes_json, created_by_user_id, created_by_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    score.createdAt,
  )

  return score
}

export async function deleteScoreById(id) {
  const db = getSqliteDb()
  db.prepare('DELETE FROM scores WHERE id = ?').run(String(id))
}
