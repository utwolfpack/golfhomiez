import { isEmail, normalizeEmail } from './team-utils.js'

const MAX_INBOX_MESSAGE_LENGTH = 2000
const MAX_INBOX_MESSAGE_ID_LENGTH = 191
const MAX_TEAM_ID_LENGTH = 191
const MAX_TEAM_NAME_LENGTH = 255
const MAX_CHALLENGE_COURSE_LENGTH = 255
const INBOX_MESSAGE_TYPES = new Set(['message', 'challenge_request', 'individual_challenge'])

export function normalizeInboxMessageType(value) {
  const normalized = String(value || 'message').trim().toLowerCase()
  return INBOX_MESSAGE_TYPES.has(normalized) ? normalized : 'message'
}

export function validateInboxRecipientEmail(value) {
  const email = normalizeEmail(value)
  if (!isEmail(email)) throw new Error('A valid recipient email is required.')
  return email
}

export function validateInboxMessageBody(value) {
  const body = String(value || '').trim()
  if (!body) throw new Error('Message is required.')
  if (body.length > MAX_INBOX_MESSAGE_LENGTH) throw new Error(`Message must be ${MAX_INBOX_MESSAGE_LENGTH} characters or less.`)
  return body
}

export function normalizeInboxMessageId(value) {
  const id = String(value || '').trim()
  if (!id) return null
  if (id.length > MAX_INBOX_MESSAGE_ID_LENGTH) throw new Error('Message thread reference is invalid.')
  return id
}

export function normalizeInboxTeamId(value) {
  const id = String(value || '').trim()
  if (!id) throw new Error('Select the team proposing the Team Challenge.')
  if (id.length > MAX_TEAM_ID_LENGTH) throw new Error('Selected team is invalid.')
  return id
}

export function validateTeamChallengeName(value) {
  const name = String(value || '').trim()
  if (!name) throw new Error('Team to Challenge is required.')
  if (name.length > MAX_TEAM_NAME_LENGTH) throw new Error(`Team to Challenge must be ${MAX_TEAM_NAME_LENGTH} characters or less.`)
  return name
}

const MAX_INDIVIDUAL_CHALLENGE_GOLFERS = 25

export function normalizeIndividualChallengeParticipantEmails(value) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/)
  const emails = []
  const seen = new Set()
  for (const raw of rawValues) {
    const email = normalizeEmail(raw)
    if (!email) continue
    if (!isEmail(email)) throw new Error('Each Individual Challenge participant must have a valid email address.')
    if (seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  if (emails.length === 0) throw new Error('Add at least one golfer email for the Individual Challenge.')
  if (emails.length > MAX_INDIVIDUAL_CHALLENGE_GOLFERS) throw new Error(`Individual Challenge supports up to ${MAX_INDIVIDUAL_CHALLENGE_GOLFERS} golfers.`)
  return emails
}


export function validateTeamChallengeDate(value) {
  const date = String(value || '').trim()
  if (!date) throw new Error('Team Challenge date is required.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Team Challenge date is invalid.')
  return date
}

export function validateTeamChallengeState(value) {
  const state = String(value || '').trim().toUpperCase()
  if (!state) throw new Error('Team Challenge state is required.')
  if (state.length > 64) throw new Error('Team Challenge state is invalid.')
  return state
}

export function validateTeamChallengeCourse(value) {
  const course = String(value || '').trim()
  if (!course) throw new Error('Team Challenge course is required.')
  if (course.length > MAX_CHALLENGE_COURSE_LENGTH) throw new Error(`Team Challenge course must be ${MAX_CHALLENGE_COURSE_LENGTH} characters or less.`)
  return course
}

export function normalizeChallengeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'accepted' || normalized === 'declined' || normalized === 'proposed') return normalized
  throw new Error('Team Challenge status is invalid.')
}


function parseIndividualChallengeParticipants(value) {
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

function parseTeamChallengeHoles(value) {
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

export function normalizeTeamChallengeHoles(value) {
  if (value == null || value === '') return []
  if (!Array.isArray(value)) throw new Error('Team Challenge holes must be an array.')
  return value.slice(0, 18).map((hole, index) => {
    const record = hole && typeof hole === 'object' ? hole : {}
    const holeNumber = Number(record.hole ?? record.holeNumber ?? record.hole_number ?? index + 1)
    const par = Number(record.par)
    const yards = Number(record.yards)
    const strokeIndex = Number(record.strokeIndex ?? record.stroke_index)
    const score = Number(record.score)
    const scoreProvided = record.scoreProvided === true || record.score_provided === true || record.scoreProvided === 1 || record.score_provided === 1 || record.scoreProvided === 'true' || record.score_provided === 'true'
    if (!Number.isFinite(holeNumber) || holeNumber < 1 || holeNumber > 18) throw new Error('Team Challenge hole score is invalid.')
    if (!Number.isFinite(score) || score < 0) throw new Error('Team Challenge hole score must be zero or greater.')
    return {
      hole: Math.trunc(holeNumber),
      par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : 4,
      yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : 0,
      strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : Math.trunc(holeNumber),
      score: Math.max(0, Math.trunc(score)),
      scoreProvided,
    }
  })
}

export function normalizeTeamChallengeScore(value) {
  const score = Number(value)
  if (!Number.isFinite(score)) throw new Error('Team Challenge score must be a number.')
  if (score < 0) throw new Error('Team Challenge score must be zero or greater.')
  return Math.trunc(score)
}

export function normalizeIndividualChallengeScore(value) {
  const score = Number(value)
  if (!Number.isFinite(score)) throw new Error('Individual Challenge score must be a number.')
  if (score < 0) throw new Error('Individual Challenge score must be zero or greater.')
  return Math.trunc(score)
}

export function normalizeInboxMessagePayload(payload = {}) {
  const messageType = normalizeInboxMessageType(payload.messageType || payload.type)
  const replyToMessageId = normalizeInboxMessageId(payload.replyToMessageId || payload.parentMessageId)
  const body = validateInboxMessageBody(payload.body || payload.message)

  if (replyToMessageId) {
    return {
      recipientEmail: normalizeEmail(payload.recipientEmail || payload.email),
      body,
      messageType,
      replyToMessageId,
      proposerTeamId: payload.proposerTeamId ? normalizeInboxTeamId(payload.proposerTeamId) : null,
      challengedTeamName: payload.challengedTeamName ? validateTeamChallengeName(payload.challengedTeamName) : null,
      challengeDate: payload.challengeDate ? validateTeamChallengeDate(payload.challengeDate) : null,
      challengeState: payload.challengeState ? validateTeamChallengeState(payload.challengeState) : null,
      challengeCourse: payload.challengeCourse ? validateTeamChallengeCourse(payload.challengeCourse) : null,
      individualParticipantEmails: null,
    }
  }

  if (messageType === 'challenge_request') {
    return {
      recipientEmail: '',
      body,
      messageType,
      replyToMessageId,
      proposerTeamId: normalizeInboxTeamId(payload.proposerTeamId || payload.senderTeamId || payload.teamId),
      challengedTeamName: validateTeamChallengeName(payload.challengedTeamName || payload.teamChallenge || payload.recipientTeamName),
      challengeDate: validateTeamChallengeDate(payload.challengeDate || payload.date),
      challengeState: validateTeamChallengeState(payload.challengeState || payload.state || payload.stateCode),
      challengeCourse: validateTeamChallengeCourse(payload.challengeCourse || payload.course),
    }
  }

  if (messageType === 'individual_challenge') {
    return {
      recipientEmail: '',
      body,
      messageType,
      replyToMessageId,
      proposerTeamId: null,
      challengedTeamName: null,
      challengeDate: validateTeamChallengeDate(payload.challengeDate || payload.date),
      challengeState: validateTeamChallengeState(payload.challengeState || payload.state || payload.stateCode),
      challengeCourse: validateTeamChallengeCourse(payload.challengeCourse || payload.course),
      individualParticipantEmails: normalizeIndividualChallengeParticipantEmails(payload.individualParticipantEmails || payload.recipientEmails || payload.participantEmails || payload.recipients),
    }
  }

  return {
    recipientEmail: validateInboxRecipientEmail(payload.recipientEmail || payload.email),
    body,
    messageType,
    replyToMessageId,
    proposerTeamId: null,
    challengedTeamName: null,
    challengeDate: null,
    challengeState: null,
    challengeCourse: null,
    individualParticipantEmails: null,
  }
}

export function mapInboxMessageRow(row = {}) {
  return {
    id: row.id,
    threadId: row.thread_id || row.threadId || row.id || null,
    parentMessageId: row.parent_message_id || row.parentMessageId || null,
    messageType: row.message_type || row.messageType || 'message',
    senderUserId: row.sender_user_id || row.senderUserId || null,
    senderEmail: row.sender_email || row.senderEmail || '',
    senderName: row.sender_name || row.senderName || null,
    recipientUserId: row.recipient_user_id || row.recipientUserId || null,
    recipientEmail: row.recipient_email || row.recipientEmail || '',
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
    proposerTeamHoles: parseTeamChallengeHoles(row.proposer_team_holes_json ?? row.proposerTeamHoles ?? row.proposerTeamHolesJson),
    challengedTeamHoles: parseTeamChallengeHoles(row.challenged_team_holes_json ?? row.challengedTeamHoles ?? row.challengedTeamHolesJson),
    individualChallengeParticipants: parseIndividualChallengeParticipants(row.individual_participants_json ?? row.individualChallengeParticipants ?? row.individualParticipantsJson),
    body: row.message_body || row.body || row.message || '',
    readAt: row.read_at || row.readAt || null,
    createdAt: row.created_at || row.createdAt || null,
  }
}

export { MAX_INBOX_MESSAGE_LENGTH }
