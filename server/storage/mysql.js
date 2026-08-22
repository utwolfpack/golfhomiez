import { v4 as uuidv4 } from 'uuid'
import { initDb, getPool } from '../db.js'
import { logError, logInfo } from '../lib/logger.js'

let scoreTableColumnsPromise = null



async function getScoreTableColumns() {
  if (!scoreTableColumnsPromise) {
    const db = getPool()
    scoreTableColumnsPromise = db.execute(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'scores'`,
    ).then(([rows]) => new Set(rows.map((row) => row.column_name ?? row.COLUMN_NAME).filter(Boolean)))
      .catch((error) => {
        scoreTableColumnsPromise = null
        throw error
      })
  }

  return scoreTableColumnsPromise
}

function hasColumn(row, columnName) {
  return Object.prototype.hasOwnProperty.call(row || {}, columnName)
}

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase()
}

function normalizeMemberStatus(status, verified = false, hasUser = false) {
  if (verified === true) return 'active'
  if (hasUser) return 'pending_verification'
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

function mapMember(row) {
  const hasUser = Boolean(row.user_id)
  const verified = hasUser ? Boolean(row.user_email_verified) : Boolean(row.verified)
  const status = normalizeMemberStatus(row.status, verified, hasUser)
  const userName = String(row.user_name || '').replace(/\s+/g, ' ').trim()
  return {
    id: row.id,
    name: userName || row.name,
    email: row.email,
    status,
    verified: verified === true,
  }
}

function mapTeam(rows, memberRows) {
  return rows.map((row) => {
    const members = memberRows
      .filter((m) => m.team_id === row.id)
      .map(mapMember)

    return {
      id: row.id,
      name: row.name,
      teamIdentifier: Number(row.team_identifier),
      createdAt: toIso(row.created_at),
      members,
      status: members.some((member) => member.status !== 'active') ? 'pending' : 'verified',
      hasPendingMembers: members.some((member) => member.status !== 'active'),
    }
  })
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
    teeColor: hasColumn(row, 'tee_color') ? (row.tee_color || 'white') : 'white',
    won: row.won == null ? null : Boolean(row.won),
    holes: row.holes_json ? (typeof row.holes_json === 'string' ? JSON.parse(row.holes_json) : row.holes_json) : null,
    opponentHoles: hasColumn(row, 'opponent_holes_json') && row.opponent_holes_json ? (typeof row.opponent_holes_json === 'string' ? JSON.parse(row.opponent_holes_json) : row.opponent_holes_json) : null,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdAt: toIso(row.created_at),
    golfCourseId: hasColumn(row, 'golf_course_id') ? row.golf_course_id : null,
    courseRating: hasColumn(row, 'course_rating') ? (row.course_rating == null ? null : Number(row.course_rating)) : null,
    slopeRating: hasColumn(row, 'slope_rating') ? (row.slope_rating == null ? null : Number(row.slope_rating)) : null,
    coursePar: hasColumn(row, 'course_par') ? (row.course_par == null ? null : Number(row.course_par)) : null,
  }
}

export async function initStorage() {
  await initDb()
  logInfo('MySQL storage initialized')
}

export async function getBackendName() {
  return 'mysql'
}

async function fetchTeamMembers(db, teamId) {
  if (teamId) {
    const [rows] = await db.execute(
      `SELECT tm.*, u.id AS user_id, u.name AS user_name, u.emailVerified AS user_email_verified
         FROM team_members tm
         LEFT JOIN \`user\` u ON LOWER(u.email) = LOWER(tm.email)
        WHERE tm.team_id = ?
        ORDER BY tm.name ASC`,
      [teamId],
    )
    return rows
  }

  const [rows] = await db.query(
    `SELECT tm.*, u.id AS user_id, u.name AS user_name, u.emailVerified AS user_email_verified
       FROM team_members tm
       LEFT JOIN \`user\` u ON LOWER(u.email) = LOWER(tm.email)
      ORDER BY tm.name ASC`,
  )
  return rows
}

export async function listTeams() {
  const db = getPool()
  const [teamRows] = await db.query('SELECT * FROM teams ORDER BY name ASC')
  const memberRows = await fetchTeamMembers(db)
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
  const memberRows = await fetchTeamMembers(db, row.id)
  return mapTeam([row], memberRows)[0] || null
}

export async function getTeamByIdentifier(identifier) {
  const normalizedIdentifier = Number(identifier)
  if (!Number.isSafeInteger(normalizedIdentifier) || normalizedIdentifier < 100) return null
  const db = getPool()
  const [rows] = await db.execute('SELECT * FROM teams WHERE team_identifier = ? LIMIT 1', [normalizedIdentifier])
  const row = rows[0]
  if (!row) return null
  const memberRows = await fetchTeamMembers(db, row.id)
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
        'INSERT INTO team_members (id, team_id, name, email, status, verified) VALUES (?, ?, ?, ?, ?, ?)',
        [member.id, team.id, member.name, normalizeEmail(member.email), normalizeMemberStatus(member.status, Boolean(member.verified)), Boolean(member.verified) ? 1 : 0],
      )
    }
    await conn.commit()
    const [createdRows] = await conn.execute('SELECT * FROM teams WHERE id = ? LIMIT 1', [team.id])
    const createdMemberRows = await fetchTeamMembers(conn, team.id)
    const createdTeam = mapTeam(createdRows, createdMemberRows)[0] || null
    logInfo('Created team', { teamId: team.id, teamIdentifier: createdTeam?.teamIdentifier || null, teamName: team.name, memberCount: members.length })
    return createdTeam
  } catch (error) {
    await conn.rollback()
    logError('Failed to create team in MySQL storage', { error, teamName: team.name })
    throw error
  } finally {
    conn.release()
  }
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
        'INSERT INTO team_members (id, team_id, name, email, status, verified) VALUES (?, ?, ?, ?, ?, ?)',
        [member.id, id, member.name, normalizeEmail(member.email), normalizeMemberStatus(member.status, Boolean(member.verified)), Boolean(member.verified) ? 1 : 0],
      )
    }
    if (existing.name !== String(name).trim()) {
      await conn.execute('UPDATE scores SET team = ? WHERE team = ?', [String(name).trim(), existing.name])
      await conn.execute('UPDATE scores SET opponent_team = ? WHERE opponent_team = ?', [String(name).trim(), existing.name])
    }
    await conn.commit()
    logInfo('Updated team', { teamId: id, teamName: String(name).trim(), memberCount: members.length })
    return getTeamById(id)
  } catch (error) {
    await conn.rollback()
    logError('Failed to update team in MySQL storage', { error, teamId: id, teamName: String(name).trim() })
    throw error
  } finally {
    conn.release()
  }
}

export async function deleteTeamById(id) {
  const db = getPool()
  const existing = await getTeamById(id)
  if (!existing) return false

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute('DELETE FROM team_members WHERE team_id = ?', [id])
    await conn.execute('DELETE FROM teams WHERE id = ?', [id])
    await conn.commit()
    logInfo('Deleted team while retaining logged events', { teamId: id, teamName: existing.name })
    return true
  } catch (error) {
    await conn.rollback()
    logError('Failed to delete team in MySQL storage', { error, teamId: id })
    throw error
  } finally {
    conn.release()
  }
}

export async function findUserByEmail(email) {
  const db = getPool()
  const normalized = normalizeEmail(email)
  const [rows] = await db.execute(
    'SELECT id, email, name, emailVerified FROM `user` WHERE LOWER(email) = ? LIMIT 1',
    [normalized],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: Boolean(row.emailVerified),
  }
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

  const columns = [
    'id',
    'mode',
    'date',
    'state',
    'course',
    'team',
    'opponent_team',
    'team_total',
    'opponent_total',
    'round_score',
    'won',
    'holes_json',
    'created_by_user_id',
    'created_by_email',
    'created_at',
  ]
  const values = [
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
    score.createdByUserId,
    score.createdByEmail,
    new Date(),
  ]

  try {
    const scoreColumns = await getScoreTableColumns()

    const optionalColumnEntries = [
      ['tee_color', score.teeColor || 'white'],
      ['opponent_holes_json', score.opponentHoles ? JSON.stringify(score.opponentHoles) : null],
      ['golf_course_id', score.golfCourseId ?? null],
      ['course_rating', score.courseRating ?? null],
      ['slope_rating', score.slopeRating ?? null],
      ['course_par', score.coursePar ?? null],
    ]

    for (const [columnName, value] of optionalColumnEntries) {
      if (scoreColumns.has(columnName)) {
        columns.push(columnName)
        values.push(value)
      }
    }

    const placeholders = columns.map(() => '?').join(', ')
    await db.execute(
      `INSERT INTO scores (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    )
    logInfo('Created score', {
      scoreId: score.id,
      mode: score.mode,
      golfCourseId: score.golfCourseId ?? null,
      createdByUserId: score.createdByUserId,
      createdByEmail: score.createdByEmail,
    })
    return score
  } catch (error) {
    logError('Failed to create score in MySQL storage', {
      error,
      scoreId: score.id,
      mode: score.mode,
      golfCourseId: score.golfCourseId ?? null,
      createdByUserId: score.createdByUserId,
      createdByEmail: score.createdByEmail,
    })
    throw error
  }
}


export async function updateScoreById(id, entry) {
  const db = getPool()
  const score = { ...entry, id }
  const columns = [
    ['mode', score.mode],
    ['date', score.date],
    ['state', score.state],
    ['course', score.course],
    ['team', score.team ?? null],
    ['opponent_team', score.opponentTeam ?? null],
    ['team_total', score.teamTotal ?? null],
    ['opponent_total', score.opponentTotal ?? null],
    ['round_score', score.roundScore ?? null],
    ['won', score.won === true ? 1 : score.won === false ? 0 : null],
    ['holes_json', score.holes ? JSON.stringify(score.holes) : null],
  ]

  try {
    const scoreColumns = await getScoreTableColumns()
    const optionalColumnEntries = [
      ['tee_color', score.teeColor || 'white'],
      ['opponent_holes_json', score.opponentHoles ? JSON.stringify(score.opponentHoles) : null],
      ['golf_course_id', score.golfCourseId ?? null],
      ['course_rating', score.courseRating ?? null],
      ['slope_rating', score.slopeRating ?? null],
      ['course_par', score.coursePar ?? null],
    ]

    for (const [columnName, value] of optionalColumnEntries) {
      if (scoreColumns.has(columnName)) columns.push([columnName, value])
    }

    const assignments = columns.map(([columnName]) => `${columnName} = ?`).join(', ')
    const values = columns.map(([, value]) => value)
    await db.execute(`UPDATE scores SET ${assignments} WHERE id = ?`, [...values, id])
    logInfo('Updated score', { scoreId: id, mode: score.mode, createdByUserId: score.createdByUserId, createdByEmail: score.createdByEmail })
    return getScoreById(id)
  } catch (error) {
    logError('Failed to update score in MySQL storage', { error, scoreId: id, mode: score.mode })
    throw error
  }
}

export async function deleteScoreById(id) {
  const db = getPool()
  try {
    await db.execute('DELETE FROM scores WHERE id = ?', [id])
    logInfo('Deleted score', { scoreId: id })
  } catch (error) {
    logError('Failed to delete score in MySQL storage', { error, scoreId: id })
    throw error
  }
}


function parseJsonArray(value) {
  if (!value) return null
  if (Array.isArray(value)) return value
  if (Buffer.isBuffer(value)) value = value.toString('utf8')
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

function mapInboxMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id || row.id,
    parentMessageId: row.parent_message_id || null,
    messageType: row.message_type,
    senderUserId: row.sender_user_id,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    senderRole: row.sender_role || null,
    recipientUserId: row.recipient_user_id,
    recipientEmail: row.recipient_email || '',
    groupId: row.group_id || null,
    tournamentId: row.tournament_id || null,
    tournamentConversationId: row.tournament_conversation_id || null,
    tournamentName: row.tournament_name || null,
    eventDate: toIso(row.event_date)?.slice(0, 10) || null,
    actionUrl: row.action_url || null,
    correlationId: row.correlation_id || null,
    proposerTeamId: row.proposer_team_id || null,
    proposerTeamName: row.proposer_team_name || null,
    challengedTeamId: row.challenged_team_id || null,
    challengedTeamName: row.challenged_team_name || null,
    challengeStatus: row.challenge_status || null,
    challengeDate: toIso(row.challenge_date)?.slice(0, 10) || null,
    challengeEndDate: hasColumn(row, 'challenge_end_date') ? (toIso(row.challenge_end_date)?.slice(0, 10) || null) : null,
    challengeState: row.challenge_state || null,
    challengeCourse: row.challenge_course || null,
    challengeTeeColor: hasColumn(row, 'challenge_tee_color') ? (row.challenge_tee_color || 'white') : 'white',
    challengeScoringType: hasColumn(row, 'challenge_scoring_type') ? (row.challenge_scoring_type || 'stroke_play') : 'stroke_play',
    challengePointsPerHole: hasColumn(row, 'challenge_points_per_hole') ? (row.challenge_points_per_hole ?? null) : null,
    proposerTeamScore: row.proposer_team_score ?? null,
    challengedTeamScore: row.challenged_team_score ?? null,
    proposerTeamHoles: parseJsonArray(row.proposer_team_holes_json),
    challengedTeamHoles: parseJsonArray(row.challenged_team_holes_json),
    individualChallengeParticipants: parseJsonArray(row.individual_participants_json) || [],
    body: row.message_body,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
  }
}

async function getInboxUserTeamIds(user) {
  const normalizedEmail = normalizeEmail(user?.email)
  if (!normalizedEmail) return new Set()
  const teams = await listTeams()
  return new Set(teams.filter((team) => (team.members || []).some((member) => normalizeEmail(member.email) === normalizedEmail)).map((team) => String(team.id)))
}


function inboxChallengeUserKey(user) {
  return `${String(user?.id || '').trim()}|${normalizeEmail(user?.email)}`
}

async function getInboxChallengeDeletedMap(user) {
  const db = getPool()
  const [rows] = await db.execute('SELECT thread_id, deleted_at FROM inbox_challenge_user_state WHERE user_key = ?', [inboxChallengeUserKey(user)])
  return new Map(rows.map((row) => [String(row.thread_id), toIso(row.deleted_at)]))
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
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [rows] = await db.execute('SELECT * FROM inbox_messages ORDER BY created_at DESC')
  const deletedMap = await getInboxChallengeDeletedMap(user)
  return rows.map(mapInboxMessage).filter((message) => canReadInboxMessage(message, user, normalizedEmail, userTeamIds)).map((message) => ({ ...message, challengeDeletedAt: deletedMap.get(String(message.threadId || message.id)) || null }))
}

export async function listSentInboxMessagesForUser(user) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [rows] = await db.execute('SELECT * FROM inbox_messages ORDER BY created_at DESC')
  const deletedMap = await getInboxChallengeDeletedMap(user)
  return rows.map(mapInboxMessage).filter((message) => canSendOrUpdateInboxMessage(message, user, normalizedEmail, userTeamIds)).map((message) => ({ ...message, challengeDeletedAt: deletedMap.get(String(message.threadId || message.id)) || null }))
}

export async function getInboxMessageForParticipant(messageId, user) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  const message = rows[0] ? mapInboxMessage(rows[0]) : null
  return message && canParticipateInInboxMessage(message, user, normalizedEmail, userTeamIds) ? message : null
}

export async function getInboxSummaryForUser(user) {
  const messages = await listInboxMessagesForUser(user)
  return { unreadCount: messages.filter((message) => message.messageType === 'message' && !message.readAt).length }
}

export async function createInboxMessage({ sender, recipient, messageType, body, threadId, parentMessageId, teamContext = null }) {
  const db = getPool()
  const id = uuidv4()
  const resolvedThreadId = threadId || id
  await db.execute(
    `INSERT INTO inbox_messages
      (id, thread_id, parent_message_id, message_type, sender_user_id, sender_email, sender_name, recipient_user_id, recipient_email, proposer_team_id, proposer_team_name, challenged_team_id, challenged_team_name, challenge_status, challenge_date, challenge_end_date, challenge_state, challenge_course, challenge_tee_color, challenge_scoring_type, challenge_points_per_hole, proposer_team_score, challenged_team_score, proposer_team_holes_json, challenged_team_holes_json, individual_participants_json, message_body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id,
      resolvedThreadId,
      parentMessageId || null,
      messageType || 'message',
      sender?.id || null,
      normalizeEmail(sender?.email),
      sender?.name || null,
      recipient?.id || null,
      normalizeEmail(recipient?.email),
      teamContext?.proposerTeamId || null,
      teamContext?.proposerTeamName || null,
      teamContext?.challengedTeamId || null,
      teamContext?.challengedTeamName || null,
      teamContext?.challengeStatus || null,
      teamContext?.challengeDate || null,
      teamContext?.challengeEndDate || null,
      teamContext?.challengeState || null,
      teamContext?.challengeCourse || null,
      teamContext?.challengeTeeColor || 'white',
      teamContext?.challengeScoringType || 'stroke_play',
      teamContext?.challengePointsPerHole ?? null,
      teamContext?.proposerTeamScore ?? null,
      teamContext?.challengedTeamScore ?? null,
      teamContext?.proposerTeamHoles ? JSON.stringify(teamContext.proposerTeamHoles) : null,
      teamContext?.challengedTeamHoles ? JSON.stringify(teamContext.challengedTeamHoles) : null,
      teamContext?.individualChallengeParticipants ? JSON.stringify(teamContext.individualChallengeParticipants) : null,
      body,
    ],
  )
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [id])
  return rows[0] ? mapInboxMessage(rows[0]) : null
}

export async function markInboxMessageRead(messageId, user) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [existingRows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  const existing = existingRows[0] ? mapInboxMessage(existingRows[0]) : null
  if (!existing || !canReadInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  await db.execute(
    `UPDATE inbox_messages
        SET read_at = COALESCE(read_at, NOW())
      WHERE id = ?`,
    [String(messageId || '')],
  )
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  return rows[0] ? mapInboxMessage(rows[0]) : null
}

export async function updateInboxChallengeStatus(messageId, user, status) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [existingRows] = await db.execute("SELECT * FROM inbox_messages WHERE id = ? AND message_type IN ('challenge_request', 'individual_challenge') LIMIT 1", [String(messageId || '')])
  const existing = existingRows[0] ? mapInboxMessage(existingRows[0]) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  await db.execute("UPDATE inbox_messages SET challenge_status = ? WHERE thread_id = ? AND message_type IN ('challenge_request', 'individual_challenge')", [status, existing.threadId || existing.id])
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  return rows[0] ? mapInboxMessage(rows[0]) : null
}


export async function updateInboxChallengeSettings(messageId, user, settings = {}) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [existingRows] = await db.execute("SELECT * FROM inbox_messages WHERE id = ? AND message_type IN ('challenge_request', 'individual_challenge') LIMIT 1", [String(messageId || '')])
  const existing = existingRows[0] ? mapInboxMessage(existingRows[0]) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  if (String(existing.challengeStatus || '').toLowerCase() === 'completed') return null

  const assignments = []
  const values = []
  const append = (column, value) => {
    assignments.push(`${column} = ?`)
    values.push(value)
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'challengeTeeColor')) append('challenge_tee_color', settings.challengeTeeColor || 'white')
  if (Object.prototype.hasOwnProperty.call(settings, 'challengeScoringType')) append('challenge_scoring_type', settings.challengeScoringType || 'stroke_play')
  if (Object.prototype.hasOwnProperty.call(settings, 'challengePointsPerHole')) append('challenge_points_per_hole', settings.challengePointsPerHole ?? null)
  if (Object.prototype.hasOwnProperty.call(settings, 'challengeDate')) append('challenge_date', settings.challengeDate || null)
  if (Object.prototype.hasOwnProperty.call(settings, 'challengeEndDate')) append('challenge_end_date', settings.challengeEndDate || null)
  if (Object.prototype.hasOwnProperty.call(settings, 'challengeState')) append('challenge_state', settings.challengeState || null)
  if (Object.prototype.hasOwnProperty.call(settings, 'challengeCourse')) append('challenge_course', settings.challengeCourse || null)
  if (assignments.length === 0) return existing

  values.push(existing.threadId || existing.id, existing.messageType)
  await db.execute(`UPDATE inbox_messages SET ${assignments.join(', ')} WHERE thread_id = ? AND message_type = ?`, values)
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  return rows[0] ? mapInboxMessage(rows[0]) : null
}

export async function addInboxIndividualChallengeParticipant(messageId, user, participant) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [existingRows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1', [String(messageId || ''), 'individual_challenge'])
  const existing = existingRows[0] ? mapInboxMessage(existingRows[0]) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  if (String(existing.challengeStatus || '').toLowerCase() === 'completed') return null

  const participantEmail = normalizeEmail(participant?.email)
  if (!participantEmail) throw new Error('Individual Challenge golfer email is required.')
  const currentParticipants = existing.individualChallengeParticipants || []
  if (currentParticipants.some((item) => normalizeEmail(item.email) === participantEmail)) {
    return { message: existing, added: false, participants: currentParticipants }
  }
  if (currentParticipants.length >= 25) throw new Error('Individual Challenge supports up to 25 golfers.')
  const participants = [...currentParticipants, {
    userId: participant?.id || participant?.userId || null,
    email: participantEmail,
    name: participant?.name || null,
    score: null,
    holes: [],
    soloScoreId: null,
  }]
  await db.execute('UPDATE inbox_messages SET individual_participants_json = ? WHERE thread_id = ? AND message_type = ?', [JSON.stringify(participants), existing.threadId || existing.id, 'individual_challenge'])
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  const message = rows[0] ? mapInboxMessage(rows[0]) : null
  return { message, added: true, participants }
}

export async function updateInboxIndividualChallengeParticipants(messageId, user, participants = []) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [existingRows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1', [String(messageId || ''), 'individual_challenge'])
  const existing = existingRows[0] ? mapInboxMessage(existingRows[0]) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  const nextParticipants = Array.isArray(participants) ? participants : []
  await db.execute('UPDATE inbox_messages SET individual_participants_json = ? WHERE thread_id = ? AND message_type = ?', [JSON.stringify(nextParticipants), existing.threadId || existing.id, 'individual_challenge'])
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  return rows[0] ? mapInboxMessage(rows[0]) : null
}

export async function updateInboxChallengeScore(messageId, user, side, score, holes = []) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [existingRows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1', [String(messageId || ''), 'challenge_request'])
  const existing = existingRows[0] ? mapInboxMessage(existingRows[0]) : null
  if (!existing || !canParticipateInInboxMessage(existing, user, normalizedEmail, userTeamIds)) return null
  if (String(existing.challengeStatus || '').toLowerCase() === 'completed') return null
  if (side === 'proposer' && !userTeamIds.has(String(existing.proposerTeamId || ''))) return null
  if (side === 'challenged' && !userTeamIds.has(String(existing.challengedTeamId || ''))) return null
  const column = side === 'proposer' ? 'proposer_team_score' : 'challenged_team_score'
  const holesColumn = side === 'proposer' ? 'proposer_team_holes_json' : 'challenged_team_holes_json'
  await db.execute(`UPDATE inbox_messages SET ${column} = ?, ${holesColumn} = ? WHERE thread_id = ? AND message_type = ?`, [score, Array.isArray(holes) && holes.length ? JSON.stringify(holes) : null, existing.threadId || existing.id, 'challenge_request'])
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  return rows[0] ? mapInboxMessage(rows[0]) : null
}


export async function updateInboxIndividualChallengeScore(messageId, user, score, holes = [], options = {}) {
  const db = getPool()
  const normalizedEmail = normalizeEmail(user?.email)
  const userTeamIds = await getInboxUserTeamIds(user)
  const [existingRows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? AND message_type = ? LIMIT 1', [String(messageId || ''), 'individual_challenge'])
  const existing = existingRows[0] ? mapInboxMessage(existingRows[0]) : null
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
  await db.execute('UPDATE inbox_messages SET individual_participants_json = ? WHERE thread_id = ? AND message_type = ?', [JSON.stringify(participants), existing.threadId || existing.id, 'individual_challenge'])
  const [rows] = await db.execute('SELECT * FROM inbox_messages WHERE id = ? LIMIT 1', [String(messageId || '')])
  return rows[0] ? mapInboxMessage(rows[0]) : null
}

export async function setInboxChallengeDeleted(messageId, user, deleted) {
  const db = getPool()
  const message = await getInboxMessageForParticipant(messageId, user)
  if (!message || !isInboxChallengeMessage(message)) return null
  const threadId = String(message.threadId || message.id)
  const deletedAt = deleted ? new Date() : null
  await db.execute(`INSERT INTO inbox_challenge_user_state (user_key, thread_id, deleted_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE deleted_at = VALUES(deleted_at), updated_at = CURRENT_TIMESTAMP`, [inboxChallengeUserKey(user), threadId, deletedAt])
  return { ...message, challengeDeletedAt: deletedAt ? deletedAt.toISOString() : null }
}
