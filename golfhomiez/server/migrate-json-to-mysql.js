import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDb, getPool } from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'server', 'data')

function readJson(name) {
  const filePath = path.join(dataDir, name)
  if (!fs.existsSync(filePath)) return []
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function toSqlDateTime(value) {
  if (!value) return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString().slice(0, 19).replace('T', ' ')
}

function ensureString(value, fallback = '') {
  return value == null ? fallback : String(value)
}

function normalizeEmail(value, fallback = '') {
  return ensureString(value, fallback).toLowerCase()
}

async function run() {
  await initDb()
  const db = await getPool()

  const users = readJson('users.json')
  const sessions = readJson('sessions.json')
  const passwordResets = readJson('password_resets.json')
  const teams = readJson('teams.json')
  const scores = readJson('scores.json')

  const usersById = new Map(users.map((user) => [user.id, user]))
  const usersByEmail = new Map(users.map((user) => [normalizeEmail(user.email), user]))
  const fallbackUser = users[0] || null

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    await conn.query('TRUNCATE TABLE team_members')
    await conn.query('TRUNCATE TABLE scores')
    await conn.query('TRUNCATE TABLE password_resets')
    await conn.query('TRUNCATE TABLE sessions')
    await conn.query('TRUNCATE TABLE teams')
    await conn.query('TRUNCATE TABLE users')
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')

    for (const user of users) {
      await conn.execute(
        `INSERT INTO users (id, email, password_hash, created_at, password_updated_at)
         VALUES (?, ?, ?, ?, ?)` ,
        [user.id, normalizeEmail(user.email), user.passwordHash || user.password || '', toSqlDateTime(user.createdAt) || toSqlDateTime(new Date()), toSqlDateTime(user.passwordUpdatedAt)]
      )
    }

    for (const session of sessions) {
      await conn.execute(
        `INSERT INTO sessions (token, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        [session.token, session.userId, toSqlDateTime(session.createdAt) || toSqlDateTime(new Date()), toSqlDateTime(session.expiresAt) || toSqlDateTime(new Date())]
      )
    }

    for (const reset of passwordResets) {
      await conn.execute(
        `INSERT INTO password_resets (id, token, user_id, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [reset.id, reset.token, reset.userId, toSqlDateTime(reset.createdAt) || toSqlDateTime(new Date()), toSqlDateTime(reset.expiresAt) || toSqlDateTime(new Date()), toSqlDateTime(reset.usedAt)]
      )
    }

    for (const team of teams) {
      await conn.execute(
        `INSERT INTO teams (id, name, created_at)
         VALUES (?, ?, ?)`,
        [team.id, team.name, toSqlDateTime(team.createdAt) || toSqlDateTime(new Date())]
      )

      for (const member of Array.isArray(team.members) ? team.members : []) {
        await conn.execute(
          `INSERT INTO team_members (id, team_id, name, email)
           VALUES (?, ?, ?, ?)`,
          [member.id, team.id, member.name, normalizeEmail(member.email)]
        )
      }
    }

    for (const score of scores) {
      const scoreEmail = normalizeEmail(score.createdByEmail)
      const resolvedUser =
        (score.createdByUserId ? usersById.get(score.createdByUserId) : null) ||
        (scoreEmail ? usersByEmail.get(scoreEmail) : null) ||
        fallbackUser

      if (!resolvedUser) {
        throw new Error(`Cannot migrate score ${ensureString(score.id, '(missing id)')}: no users exist to own the record.`)
      }

      await conn.execute(
        `INSERT INTO scores (
          id, mode, date, state, course, team, opponent_team,
          team_total, opponent_total, round_score, money, won,
          holes_json, created_by_user_id, created_by_email, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ensureString(score.id),
          score.mode === 'solo' ? 'solo' : 'team',
          ensureString(score.date),
          ensureString(score.state, 'UT').toUpperCase(),
          ensureString(score.course),
          score.team || null,
          score.opponentTeam || null,
          typeof score.teamTotal === 'number' ? score.teamTotal : null,
          typeof score.opponentTotal === 'number' ? score.opponentTotal : null,
          typeof score.roundScore === 'number' ? score.roundScore : null,
          typeof score.money === 'number' ? score.money : null,
          score.won === true ? 1 : score.won === false ? 0 : null,
          score.holes ? JSON.stringify(score.holes) : null,
          ensureString(resolvedUser.id),
          normalizeEmail(score.createdByEmail, resolvedUser.email),
          toSqlDateTime(score.createdAt) || toSqlDateTime(new Date())
        ]
      )
    }

    await conn.commit()
    console.log(`Migrated ${users.length} users, ${sessions.length} sessions, ${passwordResets.length} password resets, ${teams.length} teams, and ${scores.length} scores into MySQL.`)
  } catch (error) {
    await conn.rollback()
    console.error('Migration failed:', error)
    process.exitCode = 1
  } finally {
    conn.release()
  }
}

run()
