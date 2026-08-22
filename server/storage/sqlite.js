import { v4 as uuidv4 } from 'uuid'
import { initDb, getSqliteDb } from '../db.js'

function normalizeMemberStatus(status, verified = false) {
  if (verified === true) return 'active'
  const value = String(status || '').trim().toLowerCase()
  if (value === 'active' || value === 'pending_verification' || value === 'invited') return value
  return 'invited'
}

function toIso(value) {
  if (!value) return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

function ensureTeamIdentifierSchema() {
  const db = getSqliteDb()
  const columns = db.prepare('PRAGMA table_info(teams)').all()
  if (!columns.some((column) => column.name === 'team_identifier')) {
    db.exec('ALTER TABLE teams ADD COLUMN team_identifier INTEGER')
  }
  const teamsMissingIdentifiers = db.prepare('SELECT id FROM teams WHERE team_identifier IS NULL ORDER BY created_at ASC, id ASC').all()
  let nextIdentifier = Number(db.prepare('SELECT COALESCE(MAX(team_identifier), 99) AS max_identifier FROM teams').get()?.max_identifier || 99)
  const updateIdentifier = db.prepare('UPDATE teams SET team_identifier = ? WHERE id = ?')
  const transaction = db.transaction(() => {
    for (const team of teamsMissingIdentifiers) {
      nextIdentifier += 1
      updateIdentifier.run(nextIdentifier, team.id)
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_team_identifier ON teams (team_identifier)')
  })
  transaction()
}

function mapTeamRow(row, memberRows) {
  const members = memberRows
    .filter((member) => member.team_id === row.id)
    .map((member) => {
      const verified = Boolean(member.verified)
      const status = normalizeMemberStatus(member.status, verified)
      return { id: member.id, name: member.name, email: member.email, status, verified }
    })
  return {
    id: row.id,
    name: row.name,
    teamIdentifier: Number(row.team_identifier),
    createdAt: toIso(row.created_at),
    members,
    status: members.some((member) => member.status !== 'active') ? 'pending' : 'verified',
    hasPendingMembers: members.some((member) => member.status !== 'active'),
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
    teeColor: row.tee_color || 'white',
    won: row.won == null ? null : Boolean(row.won),
    holes: row.holes_json ? JSON.parse(row.holes_json) : null,
    opponentHoles: row.opponent_holes_json ? JSON.parse(row.opponent_holes_json) : null,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdAt: toIso(row.created_at),
  }
}

export async function initStorage() {
  await initDb()
  ensureTeamIdentifierSchema()
}

export async function getBackendName() {
  return 'sqlite'
}

export async function listTeams() {
  ensureTeamIdentifierSchema()
  const db = getSqliteDb()
  const teamRows = db.prepare('SELECT * FROM teams ORDER BY name ASC').all()
  const memberRows = db.prepare('SELECT * FROM team_members ORDER BY name ASC').all()
  return teamRows.map((row) => mapTeamRow(row, memberRows))
}

export async function getTeamById(id) {
  ensureTeamIdentifierSchema()
  const db = getSqliteDb()
  const row = db.prepare('SELECT * FROM teams WHERE id = ? LIMIT 1').get(String(id))
  if (!row) return null
  const memberRows = db.prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY name ASC').all(String(id))
  return mapTeamRow(row, memberRows)
}

export async function getTeamByName(name) {
  ensureTeamIdentifierSchema()
  const db = getSqliteDb()
  const row = db.prepare('SELECT * FROM teams WHERE lower(name) = lower(?) LIMIT 1').get(String(name || '').trim())
  if (!row) return null
  const memberRows = db.prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY name ASC').all(row.id)
  return mapTeamRow(row, memberRows)
}

export async function getTeamByIdentifier(identifier) {
  const normalizedIdentifier = Number(identifier)
  if (!Number.isSafeInteger(normalizedIdentifier) || normalizedIdentifier < 100) return null
  ensureTeamIdentifierSchema()
  const db = getSqliteDb()
  const row = db.prepare('SELECT * FROM teams WHERE team_identifier = ? LIMIT 1').get(normalizedIdentifier)
  if (!row) return null
  const memberRows = db.prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY name ASC').all(row.id)
  return mapTeamRow(row, memberRows)
}

export async function createTeam({ name, members }) {
  ensureTeamIdentifierSchema()
  const db = getSqliteDb()
  const teamIdentifier = Number(db.prepare('SELECT COALESCE(MAX(team_identifier), 99) + 1 AS next_identifier FROM teams').get()?.next_identifier || 100)
  const team = { id: uuidv4(), name: String(name).trim(), teamIdentifier, members, createdAt: new Date().toISOString() }
  const insertTeam = db.prepare('INSERT INTO teams (id, name, team_identifier, created_at) VALUES (?, ?, ?, ?)')
  const insertMember = db.prepare('INSERT INTO team_members (id, team_id, name, email, status, verified) VALUES (?, ?, ?, ?, ?, ?)')

  const transaction = db.transaction(() => {
    insertTeam.run(team.id, team.name, team.teamIdentifier, team.createdAt)
    for (const member of members) {
      insertMember.run(member.id, team.id, member.name, member.email, normalizeMemberStatus(member.status, Boolean(member.verified)), member.verified ? 1 : 0)
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
  const insertMemberStmt = db.prepare('INSERT INTO team_members (id, team_id, name, email, status, verified) VALUES (?, ?, ?, ?, ?, ?)')
  const updateTeamScoresStmt = db.prepare('UPDATE scores SET team = ? WHERE team = ?')
  const updateOpponentScoresStmt = db.prepare('UPDATE scores SET opponent_team = ? WHERE opponent_team = ?')

  const transaction = db.transaction(() => {
    updateTeamStmt.run(String(name).trim(), id)
    deleteMembersStmt.run(id)
    for (const member of members) {
      insertMemberStmt.run(member.id, id, member.name, member.email, normalizeMemberStatus(member.status, Boolean(member.verified)), member.verified ? 1 : 0)
    }
    if (existing.name !== String(name).trim()) {
      updateTeamScoresStmt.run(String(name).trim(), existing.name)
      updateOpponentScoresStmt.run(String(name).trim(), existing.name)
    }
  })

  transaction()
  return getTeamById(id)
}

export async function deleteTeamById(id) {
  const db = getSqliteDb()
  const existing = await getTeamById(id)
  if (!existing) return false

  const deleteMembersStmt = db.prepare('DELETE FROM team_members WHERE team_id = ?')
  const deleteTeamStmt = db.prepare('DELETE FROM teams WHERE id = ?')

  const transaction = db.transaction(() => {
    deleteMembersStmt.run(id)
    deleteTeamStmt.run(id)
  })

  transaction()
  return true
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
      team_total, opponent_total, round_score, won,
      holes_json, opponent_holes_json, created_by_user_id, created_by_email, created_at
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
    score.won === true ? 1 : score.won === false ? 0 : null,
    score.holes ? JSON.stringify(score.holes) : null,
    score.opponentHoles ? JSON.stringify(score.opponentHoles) : null,
    score.createdByUserId,
    score.createdByEmail,
    score.createdAt,
  )

  return score
}


export async function updateScoreById(id, entry) {
  const db = getSqliteDb()
  const score = { ...entry, id }
  db.prepare(`
    UPDATE scores
       SET mode = ?, date = ?, state = ?, course = ?, team = ?, opponent_team = ?,
           team_total = ?, opponent_total = ?, round_score = ?, won = ?,
           holes_json = ?, opponent_holes_json = ?
     WHERE id = ?
  `).run(
    score.mode,
    score.date,
    score.state,
    score.course,
    score.team ?? null,
    score.opponentTeam ?? null,
    score.teamTotal ?? null,
    score.opponentTotal ?? null,
    score.roundScore ?? null,
    score.won === true ? 1 : score.won === false ? 0 : null,
    score.holes ? JSON.stringify(score.holes) : null,
    score.opponentHoles ? JSON.stringify(score.opponentHoles) : null,
    id,
  )

  return getScoreById(id)
}

export async function deleteScoreById(id) {
  const db = getSqliteDb()
  db.prepare('DELETE FROM scores WHERE id = ?').run(String(id))
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}


function parseJsonArray(value) {
  if (!value) return null
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

function mapInboxMessageRow(row) {
  return {
    id: row.id,
    threadId: row.thread_id || row.threadId || row.id,
    parentMessageId: row.parent_message_id || row.parentMessageId || null,
    messageType: row.message_type,
    senderUserId: row.sender_user_id,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    recipientUserId: row.recipient_user_id,
    recipientEmail: row.recipient_email,
    proposerTeamId: row.proposer_team_id || row.proposerTeamId || null,
    proposerTeamName: row.proposer_team_name || row.proposerTeamName || null,
    challengedTeamId: row.challenged_team_id || row.challengedTeamId || null,
    challengedTeamName: row.challenged_team_name || row.challengedTeamName || null,
    challengeStatus: row.challenge_status || row.challengeStatus || null,
    challengeDate: row.challenge_date || row.challengeDate || null,
    challengeState: row.challenge_state || row.challengeState || null,
    challengeCourse: row.challenge_course || row.challengeCourse || null,
    challengeTeeColor: row.challenge_tee_color || row.challengeTeeColor || 'white',
    challengeScoringType: row.challenge_scoring_type || row.challengeScoringType || 'stroke_play',
    challengePointsPerHole: row.challenge_points_per_hole ?? row.challengePointsPerHole ?? null,
    proposerTeamScore: row.proposer_team_score ?? row.proposerTeamScore ?? null,
    challengedTeamScore: row.challenged_team_score ?? row.challengedTeamScore ?? null,
    proposerTeamHoles: parseJsonArray(row.proposer_team_holes_json ?? row.proposerTeamHoles),
    challengedTeamHoles: parseJsonArray(row.challenged_team_holes_json ?? row.challengedTeamHoles),
    individualChallengeParticipants: parseJsonArray(row.individual_participants_json ?? row.individualChallengeParticipants) || [],
    body: row.message_body,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
  }
}

function getInboxColumns(db) {
  try {
    return new Set(db.prepare('PRAGMA table_info(inbox_messages)').all().map((column) => column.name))
  } catch {
    return new Set()
  }
}

async function getInboxUserTeamIds(user) {
  const normalizedEmail = normalizeEmail(user?.email)
  if (!normalizedEmail) return new Set()
  const teams = await listTeams()
  return new Set(teams.filter((team) => (team.members || []).some((member) => normalizeEmail(member.email) === normalizedEmail)).map((team) => String(team.id)))
}


function inboxChallengeUserKey(user) { return `${String(user?.id || '').trim()}|${normalizeEmail(user?.email)}` }
function ensureInboxChallengeUserStateTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS inbox_challenge_user_state (user_key TEXT NOT NULL, thread_id TEXT NOT NULL, deleted_at TEXT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_key, thread_id))`)
}
function applyInboxChallengeDeletedState(db, messages, user) {
  ensureInboxChallengeUserStateTable(db)
  const rows = db.prepare('SELECT thread_id, deleted_at FROM inbox_challenge_user_state WHERE user_key = ?').all(inboxChallengeUserKey(user))
  const byThread = new Map(rows.map((row) => [String(row.thread_id), row.deleted_at || null]))
  return messages.map((message) => ({ ...message, challengeDeletedAt: byThread.get(String(message.threadId || message.id)) || null }))
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
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const rows = db.prepare('SELECT * FROM inbox_messages ORDER BY created_at DESC').all()
  return applyInboxChallengeDeletedState(db, rows.map(mapInboxMessageRow).filter((message) => canReadInboxMessage(message, user, normalizedEmail, userTeamIds)), user)
}

export async function listSentInboxMessagesForUser(user) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const rows = db.prepare('SELECT * FROM inbox_messages ORDER BY created_at DESC').all()
  return applyInboxChallengeDeletedState(db, rows.map(mapInboxMessageRow).filter((message) => canSendOrUpdateInboxMessage(message, user, normalizedEmail, userTeamIds)), user)
}

export async function getInboxMessageForParticipant(messageId, user) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  const message = row ? mapInboxMessageRow(row) : null
  return message && canParticipateInInboxMessage(message, user, normalizedEmail, userTeamIds) ? message : null
}

export async function getInboxSummaryForUser(user) {
  const messages = await listInboxMessagesForUser(user)
  return { unreadCount: messages.filter((message) => message.messageType === 'message' && !message.readAt).length }
}

export async function createInboxMessage({ sender, recipient, messageType, body, threadId, parentMessageId, teamContext = null }) {
  const db = getSqliteDb()
  const id = uuidv4()
  const createdAt = new Date().toISOString()
  const resolvedThreadId = threadId || id
  const columns = getInboxColumns(db)
  const valuesByColumn = {
    id,
    thread_id: resolvedThreadId,
    parent_message_id: parentMessageId || null,
    message_type: messageType || 'message',
    sender_user_id: sender?.id || null,
    sender_email: normalizeEmail(sender?.email),
    sender_name: sender?.name || null,
    recipient_user_id: recipient?.id || null,
    recipient_email: normalizeEmail(recipient?.email),
    proposer_team_id: teamContext?.proposerTeamId || null,
    proposer_team_name: teamContext?.proposerTeamName || null,
    challenged_team_id: teamContext?.challengedTeamId || null,
    challenged_team_name: teamContext?.challengedTeamName || null,
    challenge_status: teamContext?.challengeStatus || null,
    challenge_date: teamContext?.challengeDate || null,
    challenge_state: teamContext?.challengeState || null,
    challenge_course: teamContext?.challengeCourse || null,
    challenge_tee_color: teamContext?.challengeTeeColor || 'white',
    challenge_scoring_type: teamContext?.challengeScoringType || 'stroke_play',
    challenge_points_per_hole: teamContext?.challengePointsPerHole ?? null,
    proposer_team_score: teamContext?.proposerTeamScore ?? null,
    challenged_team_score: teamContext?.challengedTeamScore ?? null,
    proposer_team_holes_json: teamContext?.proposerTeamHoles ? JSON.stringify(teamContext.proposerTeamHoles) : null,
    challenged_team_holes_json: teamContext?.challengedTeamHoles ? JSON.stringify(teamContext.challengedTeamHoles) : null,
    individual_participants_json: teamContext?.individualChallengeParticipants ? JSON.stringify(teamContext.individualChallengeParticipants) : null,
    message_body: body,
    created_at: createdAt,
  }
  const insertColumns = Object.keys(valuesByColumn).filter((column) => column === 'id' || columns.has(column))
  const placeholders = insertColumns.map(() => '?').join(', ')
  db.prepare(`INSERT INTO inbox_messages (${insertColumns.join(', ')}) VALUES (${placeholders})`).run(...insertColumns.map((column) => valuesByColumn[column]))
  return mapInboxMessageRow(db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(id))
}

export async function markInboxMessageRead(messageId, user) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const existingRow = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  const existing = existingRow ? mapInboxMessageRow(existingRow) : null
  if (!existing || !canReadInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  db.prepare('UPDATE inbox_messages SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(new Date().toISOString(), String(messageId || ''))
  const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  return row ? mapInboxMessageRow(row) : null
}

export async function updateInboxChallengeStatus(messageId, user, status) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const existingRow = db.prepare("SELECT * FROM inbox_messages WHERE id = ? AND message_type IN ('challenge_request', 'individual_challenge') LIMIT 1").get(String(messageId || ''))
  const existing = existingRow ? mapInboxMessageRow(existingRow) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  db.prepare("UPDATE inbox_messages SET challenge_status = ? WHERE thread_id = ? AND message_type IN ('challenge_request', 'individual_challenge')").run(status, existing.threadId || existing.id)
  const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  return row ? mapInboxMessageRow(row) : null
}

export async function updateInboxIndividualChallengeParticipants(messageId, user, participants = []) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1').get(String(messageId || ''), 'individual_challenge')
  const existing = row ? mapInboxMessageRow(row) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  const nextParticipants = Array.isArray(participants) ? participants : []
  db.prepare('UPDATE inbox_messages SET individual_participants_json = ? WHERE thread_id = ? AND message_type = ?').run(JSON.stringify(nextParticipants), existing.threadId || existing.id, 'individual_challenge')
  const updated = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  return updated ? mapInboxMessageRow(updated) : null
}

export async function updateInboxChallengeScore(messageId, user, side, score, holes = []) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const existingRow = db.prepare('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1').get(String(messageId || ''), 'challenge_request')
  const existing = existingRow ? mapInboxMessageRow(existingRow) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  if (String(existing.challengeStatus || '').toLowerCase() === 'completed') return null
  if (side === 'proposer' && !userTeamIds.has(String(existing.proposerTeamId || ''))) return null
  if (side === 'challenged' && !userTeamIds.has(String(existing.challengedTeamId || ''))) return null
  const column = side === 'proposer' ? 'proposer_team_score' : 'challenged_team_score'
  const holesColumn = side === 'proposer' ? 'proposer_team_holes_json' : 'challenged_team_holes_json'
  db.prepare(`UPDATE inbox_messages SET ${column} = ?, ${holesColumn} = ? WHERE thread_id = ? AND message_type = ?`).run(score, Array.isArray(holes) && holes.length ? JSON.stringify(holes) : null, existing.threadId || existing.id, 'challenge_request')
  const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  return row ? mapInboxMessageRow(row) : null
}


export async function updateInboxIndividualChallengeScore(messageId, user, score, holes = [], options = {}) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const existingRow = db.prepare('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1').get(String(messageId || ''), 'individual_challenge')
  const existing = existingRow ? mapInboxMessageRow(existingRow) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  if (String(existing.challengeStatus || '').toLowerCase() === 'completed') return null
  let userCanEditOwnScore = false
  const participants = (existing.individualChallengeParticipants || []).map((participant) => {
    const isCurrentParticipant = String(participant.userId || '') === String(user?.id || '') || normalizeEmail(participant.email) === normalizedEmail
    if (!isCurrentParticipant) return participant
    userCanEditOwnScore = true
    const nextSoloScoreId = Object.prototype.hasOwnProperty.call(options || {}, 'soloScoreId') ? options.soloScoreId : participant.soloScoreId
    return { ...participant, score: score ?? null, holes: Array.isArray(holes) && holes.length ? holes : [], soloScoreId: nextSoloScoreId || null }
  })
  if (!userCanEditOwnScore) return null
  db.prepare('UPDATE inbox_messages SET individual_participants_json = ? WHERE thread_id = ? AND message_type = ?').run(JSON.stringify(participants), existing.threadId || existing.id, 'individual_challenge')
  const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  return row ? mapInboxMessageRow(row) : null
}

export async function setInboxChallengeDeleted(messageId, user, deleted) {
  const db = getSqliteDb()
  const message = await getInboxMessageForParticipant(messageId, user)
  if (!message || !isInboxChallengeMessage(message)) return null
  ensureInboxChallengeUserStateTable(db)
  const deletedAt = deleted ? new Date().toISOString() : null
  db.prepare(`INSERT INTO inbox_challenge_user_state (user_key, thread_id, deleted_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_key, thread_id) DO UPDATE SET deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`).run(inboxChallengeUserKey(user), String(message.threadId || message.id), deletedAt, new Date().toISOString())
  return { ...message, challengeDeletedAt: deletedAt }
}
