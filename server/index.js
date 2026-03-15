import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { auth } from './auth.js'
import { getLatestPasswordReset } from './auth-debug.js'
import storage from './storage/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT || 5001)
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5174'
const allowedOrigins = new Set([
  clientOrigin,
  'http://127.0.0.1:5174',
  'http://localhost:5174',
  'http://127.0.0.1:5001',
  'http://localhost:5001',
].filter(Boolean))

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error(`CORS blocked for origin: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.options('*', cors())
app.all('/api/auth/*', toNodeHandler(auth))
app.use(express.json())

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase()
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim())
}

function isValidPastOrTodayDate(dateStr) {
  const value = String(dateStr || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const dt = new Date(`${value}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return dt.getTime() <= today.getTime()
}

async function authMiddleware(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session?.user) return res.status(401).json({ message: 'Unauthorized' })
    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    }
    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    res.status(500).json({ message: 'Authentication failed' })
  }
}

async function findTeamByName(name) {
  return storage.getTeamByName(name)
}

async function isUserOnTeam(teamName, userEmail) {
  const team = await findTeamByName(teamName)
  if (!team) return false
  const e = normalizeEmail(userEmail)
  return (team.members || []).some((m) => normalizeEmail(m.email) === e)
}

app.get('/api/health', async (req, res) => {
  const backend = await storage.getBackendName()
  res.json({ ok: true, storage: backend })
})

app.get('/api/auth-debug/latest-reset', (req, res) => {
  const email = String(req.query.email || '').trim()
  if (!email) return res.status(400).json({ message: 'email query parameter required' })
  const latest = getLatestPasswordReset(email)
  res.json(latest || null)
})

app.get('/api/teams', authMiddleware, async (req, res) => {
  try {
    const teams = await storage.listTeams()
    res.json(teams)
  } catch (error) {
    console.error('List teams error:', error)
    res.status(500).json({ message: 'Could not load teams' })
  }
})

app.post('/api/teams', authMiddleware, async (req, res) => {
  try {
    const { name, members } = req.body || {}
    const trimmed = String(name || '').trim()
    if (!trimmed) return res.status(400).json({ message: 'Team name required' })

    const mem = Array.isArray(members) ? members : []
    const normalizedMembers = mem
      .map((m) => ({
        id: m && m.id ? String(m.id) : uuidv4(),
        name: String((m && m.name) || '').trim(),
        email: normalizeEmail((m && m.email) || ''),
      }))
      .filter((m) => m.name || m.email)

    if (normalizedMembers.length > 4) return res.status(400).json({ message: 'A team can have at most 4 members' })

    for (const m of normalizedMembers) {
      if (!m.name) return res.status(400).json({ message: 'Each team member must have a name' })
      if (!m.email) return res.status(400).json({ message: 'Each team member must have an email' })
      if (!isEmail(m.email)) return res.status(400).json({ message: `Invalid team member email: ${m.email}` })
    }

    const seen = new Set()
    for (const m of normalizedMembers) {
      if (seen.has(m.email)) return res.status(400).json({ message: 'Duplicate team member email in the same team' })
      seen.add(m.email)
    }

    const exists = await storage.getTeamByName(trimmed)
    if (exists) return res.status(409).json({ message: 'Team already exists' })

    const team = await storage.createTeam({ name: trimmed, members: normalizedMembers })
    res.status(201).json(team)
  } catch (error) {
    console.error('Create team error:', error)
    res.status(500).json({ message: 'Could not create team' })
  }
})

app.put('/api/teams/:id', authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ message: 'Team id required' })

    const { name, members } = req.body || {}
    const trimmed = String(name || '').trim()
    if (!trimmed) return res.status(400).json({ message: 'Team name required' })

    const mem = Array.isArray(members) ? members : []
    const normalizedMembers = mem
      .map((m) => ({
        id: m && m.id ? String(m.id) : uuidv4(),
        name: String((m && m.name) || '').trim(),
        email: normalizeEmail((m && m.email) || ''),
      }))
      .filter((m) => m.name || m.email)

    if (normalizedMembers.length > 4) return res.status(400).json({ message: 'A team can have at most 4 members' })

    for (const m of normalizedMembers) {
      if (!m.name) return res.status(400).json({ message: 'Each team member must have a name' })
      if (!m.email) return res.status(400).json({ message: 'Each team member must have an email' })
      if (!isEmail(m.email)) return res.status(400).json({ message: `Invalid team member email: ${m.email}` })
    }

    const seen = new Set()
    for (const m of normalizedMembers) {
      if (seen.has(m.email)) return res.status(400).json({ message: 'Duplicate team member email in the same team' })
      seen.add(m.email)
    }

    const existing = await storage.getTeamById(id)
    if (!existing) return res.status(404).json({ message: 'Team not found' })

    const nameTaken = await storage.getTeamByName(trimmed)
    if (nameTaken && String(nameTaken.id) !== id) return res.status(409).json({ message: 'Team name already exists' })

    const requesterEmail = normalizeEmail(req.user.email)
    const canEdit = (existing.members || []).some((m) => normalizeEmail(m.email) === requesterEmail)
    if (!canEdit) return res.status(403).json({ message: 'Only team members can edit this team' })

    const updated = await storage.updateTeam(id, { name: trimmed, members: normalizedMembers })
    res.json(updated)
  } catch (error) {
    console.error('Update team error:', error)
    res.status(500).json({ message: 'Could not update team' })
  }
})

app.get('/api/scores', authMiddleware, async (req, res) => {
  try {
    const scores = await storage.listScores()
    res.json(scores)
  } catch (error) {
    console.error('List scores error:', error)
    res.status(500).json({ message: 'Could not load scores' })
  }
})

app.post('/api/scores', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {}
    const mode = body.mode === 'solo' ? 'solo' : 'team'

    if (mode === 'solo') {
      const { date, state, course, roundScore, holes } = body
      if (!date || !course) return res.status(400).json({ message: 'date and course required' })
      if (!isValidPastOrTodayDate(date)) return res.status(400).json({ message: 'Date must be today or earlier' })
      if (!state || typeof state !== 'string' || !String(state).trim()) return res.status(400).json({ message: 'state required' })
      if (typeof roundScore !== 'number' || Number.isNaN(roundScore)) return res.status(400).json({ message: 'roundScore must be a number' })
      if (roundScore < 0) return res.status(400).json({ message: 'roundScore must be zero or greater' })

      const entry = await storage.createScore({
        mode: 'solo',
        date,
        state: String(state).toUpperCase(),
        course,
        roundScore,
        holes: Array.isArray(holes) ? holes : null,
        createdByUserId: req.user.id,
        createdByEmail: req.user.email,
      })
      return res.status(201).json(entry)
    }

    const { date, state, course, team, opponentTeam, teamTotal, opponentTotal, holes } = body
    if (!date || !course || !team) return res.status(400).json({ message: 'date, course, team required' })
    if (!isValidPastOrTodayDate(date)) return res.status(400).json({ message: 'Date must be today or earlier' })
    if (!state || typeof state !== 'string' || !String(state).trim()) return res.status(400).json({ message: 'state required' })
    if (!opponentTeam || !String(opponentTeam).trim()) return res.status(400).json({ message: 'opponentTeam required' })
    if (String(opponentTeam).trim().toLowerCase() === String(team).trim().toLowerCase()) {
      return res.status(400).json({ message: 'Opponent team must be different from your team' })
    }
    if (typeof teamTotal !== 'number' || Number.isNaN(teamTotal)) return res.status(400).json({ message: 'teamTotal must be a number' })
    if (typeof opponentTotal !== 'number' || Number.isNaN(opponentTotal)) return res.status(400).json({ message: 'opponentTotal must be a number' })
    if (teamTotal < 0 || opponentTotal < 0) return res.status(400).json({ message: 'Scores must be zero or greater' })

    const myTeam = await findTeamByName(team)
    if (!myTeam) return res.status(400).json({ message: 'Your team must be a known team (create it first)' })
    if (!(await isUserOnTeam(team, req.user.email))) return res.status(403).json({ message: 'You are not a member of the selected team' })

    const oppTeamObj = await findTeamByName(opponentTeam)
    if (!oppTeamObj) return res.status(400).json({ message: 'Opponent team must be a known team (create it first)' })

    const won = teamTotal < opponentTotal ? true : (teamTotal > opponentTotal ? false : null)
    const diff = Math.abs(opponentTotal - teamTotal)
    const money = won === true ? diff : won === false ? -diff : 0

    const entry = await storage.createScore({
      mode: 'team',
      date,
      state: String(state).toUpperCase(),
      course,
      team,
      opponentTeam: String(opponentTeam).trim(),
      teamTotal,
      opponentTotal,
      money,
      won,
      holes: Array.isArray(holes) ? holes : null,
      createdByUserId: req.user.id,
      createdByEmail: req.user.email,
    })
    res.status(201).json(entry)
  } catch (error) {
    console.error('Create score error:', error)
    res.status(500).json({ message: 'Could not create score' })
  }
})

app.delete('/api/scores/:id', authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const entry = await storage.getScoreById(id)
    if (!entry) return res.status(404).json({ message: 'Score not found' })

    const can = await isUserOnTeam(entry.team, req.user.email) || await isUserOnTeam(entry.opponentTeam, req.user.email)
    if (!can) return res.status(403).json({ message: 'Only members of the teams involved can delete this round' })

    await storage.deleteScoreById(id)
    res.json({ ok: true })
  } catch (error) {
    console.error('Delete score error:', error)
    res.status(500).json({ message: 'Could not delete score' })
  }
})

const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

async function bootstrap() {
  await storage.initStorage()
  const backend = await storage.getBackendName()
  console.log(`Storage backend: ${backend}`)

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`)
  })
}

bootstrap().catch((error) => {
  console.error('Startup failed:', error)
  process.exit(1)
})
