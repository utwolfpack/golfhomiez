import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())
app.use(cors({ origin: true }))

const PORT = 5000

const dataDir = path.join(__dirname, 'data')
const usersPath = path.join(dataDir, 'users.json')
const scoresPath = path.join(dataDir, 'scores.json')
const teamsPath = path.join(dataDir, 'teams.json')
const sessionsPath = path.join(dataDir, 'sessions.json')
const passwordResetsPath = path.join(dataDir, 'password_resets.json')

// Ensure data directory & files exist (so the app runs on a fresh clone)
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
if (!fs.existsSync(usersPath)) writeJson(usersPath, [])
if (!fs.existsSync(scoresPath)) writeJson(scoresPath, [])
if (!fs.existsSync(teamsPath)) writeJson(teamsPath, [])
if (!fs.existsSync(sessionsPath)) writeJson(sessionsPath, [])
if (!fs.existsSync(passwordResetsPath)) writeJson(passwordResetsPath, [])

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

function isEmail(s) {
  // intentionally simple; good enough for local app
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim())
}

function getUserById(userId) {
  const users = readJson(usersPath, [])
  return users.find(u => u.id === userId) || null
}

function purgeExpiredPasswordResets() {
  const resets = readJson(passwordResetsPath, [])
  const now = Date.now()
  const next = resets.filter(r => {
    const exp = Date.parse(r.expiresAt || '')
    return exp && exp > now && !r.usedAt
  })
  if (next.length !== resets.length) writeJson(passwordResetsPath, next)
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ message: 'Missing token' })

  const sessions = readJson(sessionsPath, [])
  const session = sessions.find(s => s.token === token)
  if (!session) return res.status(401).json({ message: 'Invalid token' })

  // expire sessions (7 days default)
  const now = Date.now()
  const exp = Date.parse(session.expiresAt || '')
  if (!exp || exp < now) {
    writeJson(sessionsPath, sessions.filter(s => s.token !== token))
    return res.status(401).json({ message: 'Session expired' })
  }

  const user = getUserById(session.userId)
  if (!user) return res.status(401).json({ message: 'Invalid session user' })

  req.user = { id: user.id, email: user.email, token }
  next()
}

function withSortedTeams(teams) {
  return [...teams].sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

app.get('/api/health', (req, res) => res.json({ ok: true }))

// ---- Auth (file-backed sessions) ----
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body || {}
  const e = normalizeEmail(email)
  const p = String(password || '')

  if (!e || !p) return res.status(400).json({ message: 'Email and password required' })
  if (!isEmail(e)) return res.status(400).json({ message: 'Email is invalid' })
  if (p.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })

  const users = readJson(usersPath, [])
  const exists = users.some(u => normalizeEmail(u.email) === e)
  if (exists) return res.status(409).json({ message: 'Email already registered' })

  const passwordHash = await bcrypt.hash(p, 10)
  const user = { id: uuidv4(), email: e, passwordHash, createdAt: new Date().toISOString() }
  users.push(user)
  writeJson(usersPath, users)

  return res.status(201).json({ message: 'Registered' })
})

app.post('/api/auth/login', async (req, res) => {
  // "Username" on the UI maps to email for now
  const { username, password } = req.body || {}
  const e = normalizeEmail(username)
  const p = String(password || '')

  if (!e || !p) return res.status(400).json({ message: 'Username and password required' })

  const users = readJson(usersPath, [])
  const user = users.find(u => normalizeEmail(u.email) === e)
  if (!user) return res.status(401).json({ message: 'Invalid credentials' })

  const ok = await bcrypt.compare(p, user.passwordHash)
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' })

  const sessions = readJson(sessionsPath, [])
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const session = { token, userId: user.id, createdAt: new Date().toISOString(), expiresAt }
  sessions.push(session)
  writeJson(sessionsPath, sessions)

  return res.json({ token, user: { id: user.id, email: user.email } })
})

// ---- Password reset (local, file-backed) ----
// Since this is a local app, we don't send email. We return a one-time token that the UI can display.
app.post('/api/auth/password-reset/request', (req, res) => {
  purgeExpiredPasswordResets()

  const { email } = req.body || {}
  const e = normalizeEmail(email)
  if (!e) return res.status(400).json({ message: 'Email required' })
  if (!isEmail(e)) return res.status(400).json({ message: 'Email is invalid' })

  const users = readJson(usersPath, [])
  const user = users.find(u => normalizeEmail(u.email) === e)

  // Always return ok to avoid username/email enumeration in a real system.
  if (!user) return res.json({ ok: true, message: 'If that account exists, a reset token is available.' })

  const resets = readJson(passwordResetsPath, [])
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes
  resets.push({
    id: uuidv4(),
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt,
    usedAt: null
  })
  writeJson(passwordResetsPath, resets)

  // Provide a helper link for local usage.
  return res.json({
    ok: true,
    message: 'Reset token created (local mode).',
    token,
    resetUrl: `/reset-password?token=${token}`,
    expiresAt
  })
})

app.post('/api/auth/password-reset/confirm', async (req, res) => {
  purgeExpiredPasswordResets()

  const { token, newPassword } = req.body || {}
  const t = String(token || '').trim()
  const p = String(newPassword || '')

  if (!t) return res.status(400).json({ message: 'Token required' })
  if (p.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })

  const resets = readJson(passwordResetsPath, [])
  const reset = resets.find(r => r.token === t)
  if (!reset || reset.usedAt) return res.status(400).json({ message: 'Invalid or used token' })

  const exp = Date.parse(reset.expiresAt || '')
  if (!exp || exp < Date.now()) return res.status(400).json({ message: 'Token expired' })

  const users = readJson(usersPath, [])
  const idx = users.findIndex(u => u.id === reset.userId)
  if (idx < 0) return res.status(400).json({ message: 'Invalid token user' })

  const passwordHash = await bcrypt.hash(p, 10)
  users[idx] = { ...users[idx], passwordHash, passwordUpdatedAt: new Date().toISOString() }
  writeJson(usersPath, users)

  // Mark token used
  const nextResets = resets.map(r => (r.token === t ? { ...r, usedAt: new Date().toISOString() } : r))
  writeJson(passwordResetsPath, nextResets)

  // Invalidate all sessions for this user
  const sessions = readJson(sessionsPath, [])
  writeJson(sessionsPath, sessions.filter(s => s.userId !== reset.userId))

  return res.json({ ok: true, message: 'Password updated. Please log in again.' })
})

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const sessions = readJson(sessionsPath, [])
  writeJson(sessionsPath, sessions.filter(s => s.token !== req.user.token))
  res.json({ ok: true })
})

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } })
})

// ---- Teams ----
app.get('/api/teams', authMiddleware, (req, res) => {
  const teams = readJson(teamsPath, [])
  res.json(withSortedTeams(teams))
})

app.post('/api/teams', authMiddleware, (req, res) => {
  const { name, members } = req.body || {}
  const trimmed = String(name || '').trim()
  if (!trimmed) return res.status(400).json({ message: 'Team name required' })

  const mem = Array.isArray(members) ? members : []
  const normalizedMembers = mem
    .map(m => ({
      id: m && m.id ? String(m.id) : uuidv4(),
      name: String((m && m.name) || '').trim(),
      email: normalizeEmail((m && m.email) || '')
    }))
    .filter(m => m.name || m.email)

  for (const m of normalizedMembers) {
    if (!m.name) return res.status(400).json({ message: 'Each team member must have a name' })
    if (!m.email) return res.status(400).json({ message: 'Each team member must have an email' })
    if (!isEmail(m.email)) return res.status(400).json({ message: `Invalid team member email: ${m.email}` })
  }

  // prevent duplicate member emails within team
  const seen = new Set()
  for (const m of normalizedMembers) {
    if (seen.has(m.email)) return res.status(400).json({ message: 'Duplicate team member email in the same team' })
    seen.add(m.email)
  }

  const teams = readJson(teamsPath, [])
  const exists = teams.some(t => String(t.name).toLowerCase() === trimmed.toLowerCase())
  if (exists) return res.status(409).json({ message: 'Team already exists' })

  const team = { id: uuidv4(), name: trimmed, members: normalizedMembers, createdAt: new Date().toISOString() }
  const next = withSortedTeams([...teams, team])
  writeJson(teamsPath, next)
  res.status(201).json(team)
})

// ---- Scores ----
app.get('/api/scores', authMiddleware, (req, res) => {
  const scores = readJson(scoresPath, [])
  res.json(scores)
})

app.post('/api/scores', authMiddleware, (req, res) => {
  const { date, course, team, opponentTeam, teamTotal, opponentTotal, money, holes } = req.body || {}
  if (!date || !course || !team) return res.status(400).json({ message: 'date, course, team required' })
  if (typeof teamTotal !== 'number') return res.status(400).json({ message: 'teamTotal must be a number' })
  if (typeof opponentTotal !== 'number') return res.status(400).json({ message: 'opponentTotal must be a number' })
  if (typeof money !== 'number') return res.status(400).json({ message: 'money must be a number (positive = won, negative = lost)' })

  const won = teamTotal < opponentTotal ? true : (teamTotal > opponentTotal ? false : null)

  const scores = readJson(scoresPath, [])
  const entry = {
    id: uuidv4(),
    date,
    course,
    team,
    opponentTeam: opponentTeam || '',
    teamTotal,
    opponentTotal,
    money,
    won,
    holes: Array.isArray(holes) ? holes : null,
    createdAt: new Date().toISOString()
  }
  scores.unshift(entry)
  writeJson(scoresPath, scores)
  res.status(201).json(entry)
})

app.delete('/api/scores/:id', authMiddleware, (req, res) => {
  const id = req.params.id
  const scores = readJson(scoresPath, [])
  writeJson(scoresPath, scores.filter(s => s.id !== id))
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})
