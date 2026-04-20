import fs from 'fs'
import crypto from 'crypto'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'server', 'data')

const usersPath = path.join(dataDir, 'users.json')
const scoresPath = path.join(dataDir, 'scores.json')
const teamsPath = path.join(dataDir, 'teams.json')
const sessionsPath = path.join(dataDir, 'sessions.json')
const passwordResetsPath = path.join(dataDir, 'password_resets.json')

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  if (!fs.existsSync(usersPath)) writeJson(usersPath, [])
  if (!fs.existsSync(scoresPath)) writeJson(scoresPath, [])
  if (!fs.existsSync(teamsPath)) writeJson(teamsPath, [])
  if (!fs.existsSync(sessionsPath)) writeJson(sessionsPath, [])
  if (!fs.existsSync(passwordResetsPath)) writeJson(passwordResetsPath, [])
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase()
}

function withSortedTeams(teams) {
  return [...teams].sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

export async function initStorage() {
  ensureDataFiles()
}

export async function getBackendName() {
  return 'json'
}

export async function getUserById(userId) {
  const users = readJson(usersPath, [])
  return users.find((u) => u.id === userId) || null
}

export async function getUserByEmail(email) {
  const e = normalizeEmail(email)
  const users = readJson(usersPath, [])
  return users.find((u) => normalizeEmail(u.email) === e) || null
}

export async function createUser({ email, passwordHash }) {
  const users = readJson(usersPath, [])
  const user = { id: uuidv4(), email: normalizeEmail(email), passwordHash, createdAt: new Date().toISOString() }
  users.push(user)
  writeJson(usersPath, users)
  return user
}

export async function updateUserPassword(userId, passwordHash) {
  const users = readJson(usersPath, [])
  const idx = users.findIndex((u) => u.id === userId)
  if (idx < 0) return null
  users[idx] = { ...users[idx], passwordHash, passwordUpdatedAt: new Date().toISOString() }
  writeJson(usersPath, users)
  return users[idx]
}

export async function createSession(userId) {
  const sessions = readJson(sessionsPath, [])
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const session = { token, userId, createdAt: new Date().toISOString(), expiresAt }
  sessions.push(session)
  writeJson(sessionsPath, sessions)
  return session
}

export async function getSessionWithUserByToken(token) {
  const sessions = readJson(sessionsPath, [])
  const session = sessions.find((s) => s.token === token)
  if (!session) return null
  const user = await getUserById(session.userId)
  if (!user) return null
  return { ...session, email: user.email }
}

export async function deleteSessionByToken(token) {
  const sessions = readJson(sessionsPath, [])
  writeJson(sessionsPath, sessions.filter((s) => s.token !== token))
}

export async function deleteSessionsByUserId(userId) {
  const sessions = readJson(sessionsPath, [])
  writeJson(sessionsPath, sessions.filter((s) => s.userId !== userId))
}

export async function purgeExpiredPasswordResets() {
  const resets = readJson(passwordResetsPath, [])
  const now = Date.now()
  const next = resets.filter((r) => {
    const exp = Date.parse(r.expiresAt || '')
    return exp && exp > now && !r.usedAt
  })
  if (next.length !== resets.length) writeJson(passwordResetsPath, next)
}

export async function createPasswordReset(userId) {
  const resets = readJson(passwordResetsPath, [])
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const reset = { id: uuidv4(), token, userId, createdAt: new Date().toISOString(), expiresAt, usedAt: null }
  resets.push(reset)
  writeJson(passwordResetsPath, resets)
  return reset
}

export async function getValidPasswordResetByToken(token) {
  const resets = readJson(passwordResetsPath, [])
  const reset = resets.find((r) => r.token === token)
  if (!reset || reset.usedAt) return null
  const exp = Date.parse(reset.expiresAt || '')
  if (!exp || exp < Date.now()) return null
  return reset
}

export async function markPasswordResetUsed(token) {
  const resets = readJson(passwordResetsPath, [])
  const nextResets = resets.map((r) => (r.token === token ? { ...r, usedAt: new Date().toISOString() } : r))
  writeJson(passwordResetsPath, nextResets)
}

export async function listTeams() {
  return withSortedTeams(readJson(teamsPath, []))
}

export async function getTeamById(id) {
  const teams = readJson(teamsPath, [])
  return teams.find((t) => String(t.id) === String(id)) || null
}

export async function getTeamByName(name) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return null
  const teams = readJson(teamsPath, [])
  return teams.find((t) => String(t.name || '').trim().toLowerCase() === n) || null
}

export async function createTeam({ name, members }) {
  const teams = readJson(teamsPath, [])
  const team = { id: uuidv4(), name: String(name).trim(), members, createdAt: new Date().toISOString() }
  const next = withSortedTeams([...teams, team])
  writeJson(teamsPath, next)
  return team
}

export async function updateTeam(id, { name, members }) {
  const teams = readJson(teamsPath, [])
  const idx = teams.findIndex((t) => String(t.id) === String(id))
  if (idx < 0) return null
  const prev = teams[idx]
  const updated = { ...prev, name: String(name).trim(), members }
  const nextTeams = withSortedTeams(teams.map((t) => (String(t.id) === String(id) ? updated : t)))
  writeJson(teamsPath, nextTeams)

  const prevName = String(prev.name || '')
  const newName = String(updated.name || '')
  if (prevName && prevName !== newName) {
    const scores = readJson(scoresPath, [])
    const nextScores = scores.map((s) => {
      const patched = { ...s }
      if (String(s.team || '') === prevName) patched.team = newName
      if (String(s.opponentTeam || '') === prevName) patched.opponentTeam = newName
      return patched
    })
    writeJson(scoresPath, nextScores)
  }

  return updated
}

export async function listScores() {
  return readJson(scoresPath, [])
}

export async function getScoreById(id) {
  const scores = readJson(scoresPath, [])
  return scores.find((s) => String(s.id) === String(id)) || null
}

export async function createScore(entry) {
  const scores = readJson(scoresPath, [])
  const score = { id: uuidv4(), ...entry, createdAt: new Date().toISOString() }
  scores.unshift(score)
  writeJson(scoresPath, scores)
  return score
}

export async function deleteScoreById(id) {
  const scores = readJson(scoresPath, [])
  writeJson(scoresPath, scores.filter((s) => String(s.id) !== String(id)))
}
