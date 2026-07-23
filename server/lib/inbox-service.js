import { isEmail, normalizeEmail } from './team-utils.js'
import { DEFAULT_TEE_COLOR, normalizeTeeColor } from './tee-colors.js'

const MAX_INBOX_MESSAGE_LENGTH = 2000
const MAX_INBOX_MESSAGE_ID_LENGTH = 191
const MAX_TEAM_ID_LENGTH = 191
const MAX_CHALLENGE_COURSE_LENGTH = 255
const INBOX_MESSAGE_TYPES = new Set(['message', 'challenge_request', 'individual_challenge'])
const TEAM_CHALLENGE_SCORING_TYPES = new Set(['stroke_play', 'skins', 'skins_push'])
const DEFAULT_TEAM_CHALLENGE_SCORING_TYPE = 'stroke_play'
const DEFAULT_TEAM_CHALLENGE_POINTS_PER_HOLE = 1

export function normalizeInboxMessageType(value) {
  const normalized = String(value || 'message').trim().toLowerCase()
  return INBOX_MESSAGE_TYPES.has(normalized) ? normalized : 'message'
}

export function normalizeTeamChallengeScoringType(value) {
  const normalized = String(value || DEFAULT_TEAM_CHALLENGE_SCORING_TYPE).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'skinspush' || normalized === 'push_skins') return 'skins_push'
  return TEAM_CHALLENGE_SCORING_TYPES.has(normalized) ? normalized : DEFAULT_TEAM_CHALLENGE_SCORING_TYPE
}

export function normalizeTeamChallengePointsPerHole(value, scoringType = DEFAULT_TEAM_CHALLENGE_SCORING_TYPE) {
  const normalizedScoringType = normalizeTeamChallengeScoringType(scoringType)
  if (normalizedScoringType === DEFAULT_TEAM_CHALLENGE_SCORING_TYPE) return null
  if (value === null || value === undefined || value === '') return DEFAULT_TEAM_CHALLENGE_POINTS_PER_HOLE
  const points = Number(value)
  if (!Number.isFinite(points) || points <= 0) throw new Error('Team Challenge points per hole must be greater than zero.')
  if (points > 10000) throw new Error('Team Challenge points per hole is too high.')
  return Math.round(points * 100) / 100
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

export function normalizeOptionalInboxMessageBody(value) {
  const body = String(value || '').trim()
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

export function validateTeamChallengeIdentifier(value) {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error('GolfHomiez Team ID is required.')
  if (!/^\d+$/.test(raw)) throw new Error('GolfHomiez Team ID must contain numbers only.')
  const identifier = Number(raw)
  if (!Number.isSafeInteger(identifier) || identifier < 100) throw new Error('GolfHomiez Team ID must be 100 or greater.')
  return identifier
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
  if (normalized === 'accepted' || normalized === 'declined' || normalized === 'proposed' || normalized === 'completed') return normalized
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
    const rawScore = record.score
    const score = Number(rawScore)
    const teeColor = normalizeTeeColor(record.teeColor || record.tee_color || record.teeBoxType || DEFAULT_TEE_COLOR)
    const scoreProvided = record.scoreProvided === true || record.score_provided === true || record.scoreProvided === 1 || record.score_provided === 1 || record.scoreProvided === 'true' || record.score_provided === 'true'
    const hasScoreValue = rawScore !== undefined && rawScore !== null && rawScore !== ''
    const normalizedScore = hasScoreValue && Number.isFinite(score) && score >= 0 ? Math.max(0, Math.trunc(score)) : null
    if (!Number.isFinite(holeNumber) || holeNumber < 1 || holeNumber > 18) throw new Error('Team Challenge hole score is invalid.')
    if (scoreProvided && normalizedScore == null) throw new Error('Team Challenge hole score must be zero or greater.')
    return {
      hole: Math.trunc(holeNumber),
      par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : 4,
      yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : null,
      strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : null,
      teeColor,
      teeBoxType: record.teeBoxType || record.tee_box_type || teeColor,
      score: normalizedScore,
      scoreProvided,
    }
  })
}

export function normalizeTeamChallengeScore(value) {
  if (value === undefined || value === null || value === '') return null
  const score = Number(value)
  if (!Number.isFinite(score)) throw new Error('Team Challenge score must be a number.')
  if (score < 0) throw new Error('Team Challenge score must be zero or greater.')
  return Math.trunc(score)
}

export function normalizeIndividualChallengeScore(value) {
  if (value === undefined || value === null || value === '') return null
  const score = Number(value)
  if (!Number.isFinite(score)) throw new Error('Individual Challenge score must be a number.')
  if (score < 0) throw new Error('Individual Challenge score must be zero or greater.')
  return Math.trunc(score)
}

export function normalizeInboxMessagePayload(payload = {}) {
  const messageType = normalizeInboxMessageType(payload.messageType || payload.type)
  const replyToMessageId = normalizeInboxMessageId(payload.replyToMessageId || payload.parentMessageId)
  const body = messageType === 'challenge_request' && !replyToMessageId
    ? normalizeOptionalInboxMessageBody(payload.body || payload.message)
    : validateInboxMessageBody(payload.body || payload.message)

  if (replyToMessageId) {
    return {
      recipientEmail: normalizeEmail(payload.recipientEmail || payload.email),
      body,
      messageType,
      replyToMessageId,
      proposerTeamId: payload.proposerTeamId ? normalizeInboxTeamId(payload.proposerTeamId) : null,
      challengedTeamIdentifier: payload.challengedTeamIdentifier ? validateTeamChallengeIdentifier(payload.challengedTeamIdentifier) : null,
      challengeDate: payload.challengeDate ? validateTeamChallengeDate(payload.challengeDate) : null,
      challengeState: payload.challengeState ? validateTeamChallengeState(payload.challengeState) : null,
      challengeCourse: payload.challengeCourse ? validateTeamChallengeCourse(payload.challengeCourse) : null,
      challengeTeeColor: normalizeTeeColor(payload.challengeTeeColor || payload.teeColor || DEFAULT_TEE_COLOR),
      challengeScoringType: normalizeTeamChallengeScoringType(payload.challengeScoringType),
      challengePointsPerHole: normalizeTeamChallengePointsPerHole(payload.challengePointsPerHole, payload.challengeScoringType),
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
      challengedTeamIdentifier: validateTeamChallengeIdentifier(payload.challengedTeamIdentifier || payload.teamIdentifier || payload.teamChallenge),
      challengeDate: validateTeamChallengeDate(payload.challengeDate || payload.date),
      challengeState: validateTeamChallengeState(payload.challengeState || payload.state || payload.stateCode),
      challengeCourse: validateTeamChallengeCourse(payload.challengeCourse || payload.course),
      challengeTeeColor: normalizeTeeColor(payload.challengeTeeColor || payload.teeColor || DEFAULT_TEE_COLOR),
      challengeScoringType: normalizeTeamChallengeScoringType(payload.challengeScoringType || payload.scoringType),
      challengePointsPerHole: normalizeTeamChallengePointsPerHole(payload.challengePointsPerHole ?? payload.pointsPerHole, payload.challengeScoringType || payload.scoringType),
    }
  }

  if (messageType === 'individual_challenge') {
    return {
      recipientEmail: '',
      body,
      messageType,
      replyToMessageId,
      proposerTeamId: null,
      challengedTeamIdentifier: null,
      challengeDate: validateTeamChallengeDate(payload.challengeDate || payload.date),
      challengeState: validateTeamChallengeState(payload.challengeState || payload.state || payload.stateCode),
      challengeCourse: validateTeamChallengeCourse(payload.challengeCourse || payload.course),
      challengeTeeColor: normalizeTeeColor(payload.challengeTeeColor || payload.teeColor || DEFAULT_TEE_COLOR),
      challengeScoringType: DEFAULT_TEAM_CHALLENGE_SCORING_TYPE,
      challengePointsPerHole: null,
      individualParticipantEmails: normalizeIndividualChallengeParticipantEmails(payload.individualParticipantEmails || payload.recipientEmails || payload.participantEmails || payload.recipients),
    }
  }

  return {
    recipientEmail: validateInboxRecipientEmail(payload.recipientEmail || payload.email),
    body,
    messageType,
    replyToMessageId,
    proposerTeamId: null,
    challengedTeamIdentifier: null,
    challengeDate: null,
    challengeState: null,
    challengeCourse: null,
    challengeTeeColor: DEFAULT_TEE_COLOR,
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
    challengeTeeColor: normalizeTeeColor(row.challenge_tee_color || row.challengeTeeColor || DEFAULT_TEE_COLOR),
    challengeScoringType: normalizeTeamChallengeScoringType(row.challenge_scoring_type || row.challengeScoringType),
    challengePointsPerHole: row.challenge_points_per_hole ?? row.challengePointsPerHole ?? null,
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
