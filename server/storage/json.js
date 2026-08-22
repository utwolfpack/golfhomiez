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
const inboxChallengeUserStatePath = path.join(dataDir, 'inbox_challenge_user_state.json')

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  if (!fs.existsSync(usersPath)) writeJson(usersPath, [])
  if (!fs.existsSync(scoresPath)) writeJson(scoresPath, [])
  if (!fs.existsSync(teamsPath)) writeJson(teamsPath, [])
  if (!fs.existsSync(sessionsPath)) writeJson(sessionsPath, [])
  if (!fs.existsSync(passwordResetsPath)) writeJson(passwordResetsPath, [])
  if (!fs.existsSync(inboxChallengeUserStatePath)) writeJson(inboxChallengeUserStatePath, [])
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

function normalizeMemberStatus(status, verified = false) {
  if (verified === true) return 'active'
  const value = String(status || '').trim().toLowerCase()
  if (value === 'active' || value === 'pending_verification' || value === 'invited') return value
  return 'invited'
}

function normalizeTeamIdentifier(value) {
  const identifier = Number(value)
  return Number.isSafeInteger(identifier) && identifier >= 100 ? identifier : null
}

function ensureTeamIdentifiers(teams) {
  const used = new Set()
  let nextIdentifier = Math.max(99, ...teams.map((team) => normalizeTeamIdentifier(team.teamIdentifier) || 99))
  let changed = false
  const nextTeams = teams.map((team) => {
    const identifier = normalizeTeamIdentifier(team.teamIdentifier)
    if (identifier != null && !used.has(identifier)) {
      used.add(identifier)
      return team
    }
    do {
      nextIdentifier += 1
    } while (used.has(nextIdentifier))
    used.add(nextIdentifier)
    changed = true
    return { ...team, teamIdentifier: nextIdentifier }
  })
  return { teams: nextTeams, changed }
}

function normalizeTeamForResponse(team) {
  const members = (team.members || []).map((member) => {
    const verified = Boolean(member.verified)
    const status = normalizeMemberStatus(member.status, verified)
    return { ...member, status, verified }
  })
  return {
    ...team,
    teamIdentifier: normalizeTeamIdentifier(team.teamIdentifier),
    members,
    status: members.some((member) => member.status !== 'active') ? 'pending' : 'verified',
    hasPendingMembers: members.some((member) => member.status !== 'active'),
  }
}

function withSortedTeams(teams) {
  return [...teams].map(normalizeTeamForResponse).sort((a, b) => String(a.name).localeCompare(String(b.name)))
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
  const current = readJson(teamsPath, [])
  const { teams, changed } = ensureTeamIdentifiers(current)
  if (changed) writeJson(teamsPath, teams)
  return withSortedTeams(teams)
}

export async function getTeamById(id) {
  const teams = await listTeams()
  const team = teams.find((t) => String(t.id) === String(id)) || null
  return team ? normalizeTeamForResponse(team) : null
}

export async function getTeamByName(name) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return null
  const teams = await listTeams()
  const team = teams.find((t) => String(t.name || '').trim().toLowerCase() === n) || null
  return team ? normalizeTeamForResponse(team) : null
}

export async function getTeamByIdentifier(identifier) {
  const normalizedIdentifier = normalizeTeamIdentifier(identifier)
  if (normalizedIdentifier == null) return null
  const teams = await listTeams()
  return teams.find((team) => team.teamIdentifier === normalizedIdentifier) || null
}

export async function createTeam({ name, members }) {
  const teams = await listTeams()
  const teamIdentifier = Math.max(99, ...teams.map((team) => normalizeTeamIdentifier(team.teamIdentifier) || 99)) + 1
  const team = { id: uuidv4(), name: String(name).trim(), teamIdentifier, members, createdAt: new Date().toISOString() }
  const next = withSortedTeams([...teams, team])
  writeJson(teamsPath, next)
  return normalizeTeamForResponse(team)
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

export async function deleteTeamById(id) {
  const teams = readJson(teamsPath, [])
  const beforeCount = teams.length
  const nextTeams = teams.filter((t) => String(t.id) !== String(id))
  if (nextTeams.length === beforeCount) return false
  writeJson(teamsPath, withSortedTeams(nextTeams))
  return true
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
  const score = { id: uuidv4(), teeColor: entry.teeColor || 'white', ...entry, createdAt: new Date().toISOString() }
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
    challengeTeeColor: message.challengeTeeColor || 'white',
    challengeScoringType: message.challengeScoringType || 'stroke_play',
    challengePointsPerHole: message.challengePointsPerHole ?? null,
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

function isInboxChallengeMessage(message) {
  return isInboxTeamChallenge(message) || isInboxIndividualChallenge(message)
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

function inboxChallengeUserKey(user) { return `${String(user?.id || '').trim()}|${normalizeEmail(user?.email)}` }
function applyInboxChallengeDeletedState(messages, user) {
  const key = inboxChallengeUserKey(user)
  const states = readJson(inboxChallengeUserStatePath, [])
  const byThread = new Map(states.filter((state) => state.userKey === key).map((state) => [String(state.threadId), state.deletedAt || null]))
  return messages.map((message) => ({ ...message, challengeDeletedAt: byThread.get(String(message.threadId || message.id)) || null }))
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
  return applyInboxChallengeDeletedState(readJson(inboxMessagesPath, [])
    .map(hydrateInboxMessage)
    .filter((message) => canReadInboxMessage(message, user, normalizedEmail, userTeamIds))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), user)
}

export async function listSentInboxMessagesForUser(user) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  return applyInboxChallengeDeletedState(readJson(inboxMessagesPath, [])
    .map(hydrateInboxMessage)
    .filter((message) => canSendOrUpdateInboxMessage(message, user, normalizedEmail, userTeamIds))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), user)
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
  return { unreadCount: messages.filter((message) => message.messageType === 'message' && !message.readAt).length }
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
    challengeTeeColor: teamContext?.challengeTeeColor || 'white',
    challengeScoringType: teamContext?.challengeScoringType || 'stroke_play',
    challengePointsPerHole: teamContext?.challengePointsPerHole ?? null,
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
    return String(hydrated.id) === String(messageId) && isInboxChallengeMessage(hydrated) && canParticipateInInboxMessage(hydrated, user, normalizedEmail, userTeamIds)
  })
  if (idx < 0) return null
  const targetThreadId = hydrateInboxMessage(messages[idx]).threadId || messages[idx].id
  const nextMessages = messages.map((message) => {
    const hydrated = hydrateInboxMessage(message)
    if (isInboxChallengeMessage(hydrated) && String(hydrated.threadId || hydrated.id) === String(targetThreadId)) {
      return { ...message, challengeStatus: status }
    }
    return message
  })
  writeJson(inboxMessagesPath, nextMessages)
  return hydrateInboxMessage(nextMessages[idx])
}

export async function updateInboxIndividualChallengeParticipants(messageId, user, participants = []) {
  ensureInboxMessagesFile()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const messages = readJson(inboxMessagesPath, [])
  const hydratedMessages = messages.map(hydrateInboxMessage)
  const target = hydratedMessages.find((message) => String(message.id) === String(messageId || '') && message.messageType === 'individual_challenge')
  if (!target || !canParticipateInInboxMessage(target, user, normalizedEmail, userTeamIds)) return null
  const threadId = target.threadId || target.id
  const nextParticipants = Array.isArray(participants) ? participants : []
  const nextMessages = messages.map((message) => {
    const hydrated = hydrateInboxMessage(message)
    if (hydrated.messageType !== 'individual_challenge' || String(hydrated.threadId || hydrated.id) !== String(threadId)) return message
    return { ...message, individualChallengeParticipants: nextParticipants }
  })
  writeJson(inboxMessagesPath, nextMessages)
  return hydrateInboxMessage(nextMessages.find((message) => String(message.id) === String(messageId || '')))
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
  if (String(existing.challengeStatus || '').toLowerCase() === 'completed') return null
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
  if (String(target.challengeStatus || '').toLowerCase() === 'completed') return null
  const threadId = target.threadId || target.id
  let userCanEditOwnScore = false
  const nextMessages = messages.map((message) => {
    const hydrated = hydrateInboxMessage(message)
    if (hydrated.messageType !== 'individual_challenge' || String(hydrated.threadId || hydrated.id) !== String(threadId)) return message
    const participants = (hydrated.individualChallengeParticipants || []).map((participant) => {
      const isCurrentParticipant = String(participant.userId || '') === String(user?.id || '') || normalizeEmail(participant.email) === normalizedEmail
      if (!isCurrentParticipant) return participant
      userCanEditOwnScore = true
      const nextSoloScoreId = Object.prototype.hasOwnProperty.call(options || {}, 'soloScoreId') ? options.soloScoreId : participant.soloScoreId
      return { ...participant, score: score ?? null, holes: Array.isArray(holes) && holes.length ? holes : [], soloScoreId: nextSoloScoreId || null }
    })
    return { ...message, individualChallengeParticipants: participants }
  })
  if (!userCanEditOwnScore) return null
  writeJson(inboxMessagesPath, nextMessages)
  return hydrateInboxMessage(nextMessages.find((message) => String(message.id) === String(messageId || '')))
}

export async function setInboxChallengeDeleted(messageId, user, deleted) {
  ensureInboxMessagesFile()
  const message = await getInboxMessageForParticipant(messageId, user)
  if (!message || !isInboxChallengeMessage(message)) return null
  const states = readJson(inboxChallengeUserStatePath, [])
  const userKey = inboxChallengeUserKey(user)
  const threadId = String(message.threadId || message.id)
  const next = states.filter((state) => !(state.userKey === userKey && String(state.threadId) === threadId))
  next.push({ userKey, threadId, deletedAt: deleted ? new Date().toISOString() : null })
  writeJson(inboxChallengeUserStatePath, next)
  return { ...message, challengeDeletedAt: deleted ? next[next.length - 1].deletedAt : null }
}
