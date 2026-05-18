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


export async function updateScoreById(id, entry) {
  const scores = readJson(scoresPath, [])
  const idx = scores.findIndex((s) => String(s.id) === String(id))
  if (idx < 0) return null
  const updated = { ...scores[idx], ...entry, id: scores[idx].id, createdAt: scores[idx].createdAt }
  scores[idx] = updated
  writeJson(scoresPath, scores)
  return updated
}

export async function deleteScoreById(id) {
  const scores = readJson(scoresPath, [])
  writeJson(scoresPath, scores.filter((s) => String(s.id) !== String(id)))
}

const inboxMessagesPath = path.join(dataDir, 'inbox_messages.json')

function ensureInboxMessagesFile() {
  ensureDataFiles()
  if (!fs.existsSync(inboxMessagesPath)) writeJson(inboxMessagesPath, [])
}

function hydrateInboxMessage(message) {
  return {
    ...message,
    threadId: message.threadId || message.id,
    parentMessageId: message.parentMessageId || null,
    proposerTeamId: message.proposerTeamId || null,
    proposerTeamName: message.proposerTeamName || null,
    challengedTeamId: message.challengedTeamId || null,
    challengedTeamName: message.challengedTeamName || null,
    challengeStatus: message.challengeStatus || null,
    challengeDate: message.challengeDate || null,
    challengeState: message.challengeState || null,
    challengeCourse: message.challengeCourse || null,
    proposerTeamScore: message.proposerTeamScore ?? null,
    challengedTeamScore: message.challengedTeamScore ?? null,
    proposerTeamHoles: Array.isArray(message.proposerTeamHoles) ? message.proposerTeamHoles : null,
    challengedTeamHoles: Array.isArray(message.challengedTeamHoles) ? message.challengedTeamHoles : null,
    individualChallengeParticipants: Array.isArray(message.individualChallengeParticipants) ? message.individualChallengeParticipants : [],
  }
}

async function getInboxUserTeamIds(user) {
  const normalizedEmail = normalizeEmail(user?.email)
  if (!normalizedEmail) return new Set()
  const teams = await listTeams()
  return new Set(teams.filter((team) => (team.members || []).some((member) => normalizeEmail(member.email) === normalizedEmail)).map((team) => String(team.id)))
}

function isInboxDirectRecipient(message, user, normalizedEmail) {
  return String(message.recipientUserId || '') === String(user?.id || '') || normalizeEmail(message.recipientEmail) === normalizedEmail
}

function isInboxDirectSender(message, user, normalizedEmail) {
  return String(message.senderUserId || '') === String(user?.id || '') || normalizeEmail(message.senderEmail) === normalizedEmail
}

function isInboxTeamChallenge(message) {
  return message.messageType === 'challenge_request'
}

function isInboxIndividualChallenge(message) {
  return message.messageType === 'individual_challenge'
}

function isInboxIndividualChallengeParticipant(message, user, normalizedEmail) {
  return (message.individualChallengeParticipants || []).some((participant) =>
    String(participant.userId || '') === String(user?.id || '') || normalizeEmail(participant.email) === normalizedEmail)
}

function canReadInboxMessage(message, user, normalizedEmail, userTeamIds) {
  return isInboxDirectRecipient(message, user, normalizedEmail) ||
    (isInboxTeamChallenge(message) && userTeamIds.has(String(message.challengedTeamId || ''))) ||
    (isInboxIndividualChallenge(message) && isInboxIndividualChallengeParticipant(message, user, normalizedEmail))
}

function canSendOrUpdateInboxMessage(message, user, normalizedEmail, userTeamIds) {
  return isInboxDirectSender(message, user, normalizedEmail) ||
    (isInboxTeamChallenge(message) && userTeamIds.has(String(message.proposerTeamId || ''))) ||
    (isInboxIndividualChallenge(message) && isInboxIndividualChallengeParticipant(message, user, normalizedEmail))
}

function canParticipateInInboxMessage(message, user, normalizedEmail, userTeamIds) {
  return isInboxDirectRecipient(message, user, normalizedEmail) ||
    isInboxDirectSender(message, user, normalizedEmail) ||
    (isInboxTeamChallenge(message) && (userTeamIds.has(String(message.proposerTeamId || '')) || userTeamIds.has(String(message.challengedTeamId || '')))) ||
    (isInboxIndividualChallenge(message) && isInboxIndividualChallengeParticipant(message, user, normalizedEmail))
}

export async function listInboxMessagesForUser(user) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  return readJson(inboxMessagesPath, [])
    .map(hydrateInboxMessage)
    .filter((message) => canReadInboxMessage(message, user, normalizedEmail, userTeamIds))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

export async function listSentInboxMessagesForUser(user) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  return readJson(inboxMessagesPath, [])
    .map(hydrateInboxMessage)
    .filter((message) => canSendOrUpdateInboxMessage(message, user, normalizedEmail, userTeamIds))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

export async function getInboxMessageForParticipant(messageId, user) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const message = readJson(inboxMessagesPath, [])
    .map(hydrateInboxMessage)
    .find((item) => String(item.id) === String(messageId))
  return message && canParticipateInInboxMessage(message, user, normalizedEmail, userTeamIds) ? message : null
}

export async function getInboxSummaryForUser(user) {
  const messages = await listInboxMessagesForUser(user)
  return { unreadCount: messages.filter((message) => !message.readAt).length }
}

export async function createInboxMessage({ sender, recipient, messageType, body, threadId, parentMessageId, teamContext = null }) {
  ensureInboxMessagesFile()
  const messages = readJson(inboxMessagesPath, [])
  const id = uuidv4()
  const message = {
    id,
    threadId: threadId || id,
    parentMessageId: parentMessageId || null,
    messageType: messageType || 'message',
    senderUserId: sender?.id || null,
    senderEmail: normalizeEmail(sender?.email),
    senderName: sender?.name || null,
    recipientUserId: recipient?.id || null,
    recipientEmail: normalizeEmail(recipient?.email),
    proposerTeamId: teamContext?.proposerTeamId || null,
    proposerTeamName: teamContext?.proposerTeamName || null,
    challengedTeamId: teamContext?.challengedTeamId || null,
    challengedTeamName: teamContext?.challengedTeamName || null,
    challengeStatus: teamContext?.challengeStatus || null,
    challengeDate: teamContext?.challengeDate || null,
    challengeState: teamContext?.challengeState || null,
    challengeCourse: teamContext?.challengeCourse || null,
    proposerTeamScore: teamContext?.proposerTeamScore ?? null,
    challengedTeamScore: teamContext?.challengedTeamScore ?? null,
    proposerTeamHoles: teamContext?.proposerTeamHoles || null,
    challengedTeamHoles: teamContext?.challengedTeamHoles || null,
    individualChallengeParticipants: teamContext?.individualChallengeParticipants || [],
    body,
    readAt: null,
    createdAt: new Date().toISOString(),
  }
  messages.unshift(message)
  writeJson(inboxMessagesPath, messages)
  return message
}

export async function markInboxMessageRead(messageId, user) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const messages = readJson(inboxMessagesPath, [])
  const idx = messages.findIndex((message) => {
    const hydrated = hydrateInboxMessage(message)
    return String(hydrated.id) === String(messageId) && canReadInboxMessage(hydrated, user, normalizedEmail, userTeamIds)
  })
  if (idx < 0) return null
  messages[idx] = { ...messages[idx], readAt: messages[idx].readAt || new Date().toISOString() }
  writeJson(inboxMessagesPath, messages)
  return hydrateInboxMessage(messages[idx])
}

export async function updateInboxChallengeStatus(messageId, user, status) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const messages = readJson(inboxMessagesPath, [])
  const idx = messages.findIndex((message) => {
    const hydrated = hydrateInboxMessage(message)
    return String(hydrated.id) === String(messageId) && hydrated.messageType === 'challenge_request' && canParticipateInInboxMessage(hydrated, user, normalizedEmail, userTeamIds)
  })
  if (idx < 0) return null
  const targetThreadId = hydrateInboxMessage(messages[idx]).threadId || messages[idx].id
  const nextMessages = messages.map((message) => {
    const hydrated = hydrateInboxMessage(message)
    if (hydrated.messageType === 'challenge_request' && String(hydrated.threadId || hydrated.id) === String(targetThreadId)) {
      return { ...message, challengeStatus: status }
    }
    return message
  })
  writeJson(inboxMessagesPath, nextMessages)
  return hydrateInboxMessage(nextMessages[idx])
}

export async function updateInboxChallengeScore(messageId, user, side, score, holes = []) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const messages = readJson(inboxMessagesPath, [])
  const idx = messages.findIndex((message) => {
    const hydrated = hydrateInboxMessage(message)
    return String(hydrated.id) === String(messageId) && hydrated.messageType === 'challenge_request' && canParticipateInInboxMessage(hydrated, user, normalizedEmail, userTeamIds)
  })
  if (idx < 0) return null
  const existing = hydrateInboxMessage(messages[idx])
  if (side === 'proposer' && !userTeamIds.has(String(existing.proposerTeamId || ''))) return null
  if (side === 'challenged' && !userTeamIds.has(String(existing.challengedTeamId || ''))) return null
  const targetThreadId = existing.threadId || existing.id
  const scoreKey = side === 'proposer' ? 'proposerTeamScore' : 'challengedTeamScore'
  const holesKey = side === 'proposer' ? 'proposerTeamHoles' : 'challengedTeamHoles'
  const nextMessages = messages.map((message) => {
    const hydrated = hydrateInboxMessage(message)
    if (hydrated.messageType === 'challenge_request' && String(hydrated.threadId || hydrated.id) === String(targetThreadId)) {
      return { ...message, [scoreKey]: score, [holesKey]: Array.isArray(holes) && holes.length ? holes : null }
    }
    return message
  })
  writeJson(inboxMessagesPath, nextMessages)
  return hydrateInboxMessage(nextMessages[idx])
}


export async function updateInboxIndividualChallengeScore(messageId, user, score, holes = [], options = {}) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const messages = readJson(inboxMessagesPath, [])
  const hydratedMessages = messages.map(hydrateInboxMessage)
  const target = hydratedMessages.find((message) => String(message.id) === String(messageId || '') && message.messageType === 'individual_challenge')
  if (!target || !canParticipateInInboxMessage(target, user, normalizedEmail, userTeamIds)) return null
  const threadId = target.threadId || target.id
  let userCanEditOwnScore = false
  const nextMessages = messages.map((message) => {
    const hydrated = hydrateInboxMessage(message)
    if (hydrated.messageType !== 'individual_challenge' || String(hydrated.threadId || hydrated.id) !== String(threadId)) return message
    const participants = (hydrated.individualChallengeParticipants || []).map((participant) => {
      const isCurrentParticipant = String(participant.userId || '') === String(user?.id || '') || normalizeEmail(participant.email) === normalizedEmail
      if (!isCurrentParticipant) return participant
      userCanEditOwnScore = true
      return { ...participant, score, holes: Array.isArray(holes) && holes.length ? holes : [], soloScoreId: options?.soloScoreId || participant.soloScoreId || null }
    })
    return { ...message, individualChallengeParticipants: participants }
  })
  if (!userCanEditOwnScore) return null
  writeJson(inboxMessagesPath, nextMessages)
  return hydrateInboxMessage(nextMessages.find((message) => String(message.id) === String(messageId || '')))
}
