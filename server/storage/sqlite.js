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
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const rows = db.prepare('SELECT * FROM inbox_messages ORDER BY created_at DESC').all()
  return rows.map(mapInboxMessageRow).filter((message) => canReadInboxMessage(message, user, normalizedEmail, userTeamIds))
}

export async function listSentInboxMessagesForUser(user) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const rows = db.prepare('SELECT * FROM inbox_messages ORDER BY created_at DESC').all()
  return rows.map(mapInboxMessageRow).filter((message) => canSendOrUpdateInboxMessage(message, user, normalizedEmail, userTeamIds))
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
  const existingRow = db.prepare('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1').get(String(messageId || ''), 'challenge_request')
  const existing = existingRow ? mapInboxMessageRow(existingRow) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  db.prepare('UPDATE inbox_messages SET challenge_status = ? WHERE thread_id = ? AND message_type = ?').run(status, existing.threadId || existing.id, 'challenge_request')
  const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  return row ? mapInboxMessageRow(row) : null
}

export async function updateInboxChallengeScore(messageId, user, side, score, holes = []) {
  const db = getSqliteDb()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const existingRow = db.prepare('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1').get(String(messageId || ''), 'challenge_request')
  const existing = existingRow ? mapInboxMessageRow(existingRow) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
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
  let userCanEditOwnScore = false
  const participants = (existing.individualChallengeParticipants || []).map((participant) => {
    const isCurrentParticipant = String(participant.userId || '') === String(user?.id || '') || normalizeEmail(participant.email) === normalizedEmail
    if (!isCurrentParticipant) return participant
    userCanEditOwnScore = true
    return { ...participant, score, holes: Array.isArray(holes) && holes.length ? holes : [], soloScoreId: options?.soloScoreId || participant.soloScoreId || null }
  })
  if (!userCanEditOwnScore) return null
  db.prepare('UPDATE inbox_messages SET individual_participants_json = ? WHERE thread_id = ? AND message_type = ?').run(JSON.stringify(participants), existing.threadId || existing.id, 'individual_challenge')
  const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1').get(String(messageId || ''))
  return row ? mapInboxMessageRow(row) : null
}
