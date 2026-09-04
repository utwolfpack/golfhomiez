const SCORE_FLOW_VERSION = 1
export const SCORE_FLOW_TTL_MS = 12 * 60 * 60 * 1000
const CHALLENGE_SCORE_FLOW_PREFIX = 'gh.scoreFlow.challenge.'
const SOLO_SCORE_FLOW_PREFIX = 'gh.scoreFlow.solo.'
const ROUND_EDIT_SCORE_FLOW_PREFIX = 'gh.scoreFlow.roundEdit.'

export type ChallengeScoreFlowState = {
  version: 1
  userId: string
  kind: 'team' | 'individual'
  threadId: string
  side?: 'proposer' | 'challenged'
  participantEmail?: string
  activeHole: number
  savedAt: number
}

export type RoundEditScoreFlowState = {
  version: 1
  userId: string
  roundId: string
  side: 'solo' | 'team' | 'opponent'
  activeHole: number
  savedAt: number
}

export type SoloScoreFlowState = {
  version: 1
  userId: string
  date: string
  state: string
  course: string
  courseId: string
  courseSearch: string
  teeColor: string
  activeHole: number
  savedAt: number
}

function normalizedUserId(userId: string | null | undefined) {
  return String(userId || '').trim()
}

function normalizedHoleNumber(value: unknown) {
  const hole = Number(value)
  if (!Number.isFinite(hole)) return 1
  return Math.max(1, Math.min(18, Math.trunc(hole)))
}

function storageKey(prefix: string, userId: string | null | undefined) {
  const id = normalizedUserId(userId)
  return id ? `${prefix}${encodeURIComponent(id)}` : ''
}

function getSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage || null
  } catch {
    return null
  }
}

function removeStoredValue(key: string) {
  if (!key) return
  try {
    getSessionStorage()?.removeItem(key)
  } catch {
    // Score-entry resume state is best-effort and must never block scoring.
  }
}

function readStoredValue(key: string): unknown {
  if (!key) return null
  try {
    const raw = getSessionStorage()?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    removeStoredValue(key)
    return null
  }
}

function writeStoredValue(key: string, value: unknown) {
  if (!key) return
  try {
    getSessionStorage()?.setItem(key, JSON.stringify(value))
  } catch {
    // Mobile browsers can reject storage writes; scoring still continues normally.
  }
}

function isFresh(savedAt: unknown) {
  const timestamp = Number(savedAt)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false
  const age = Date.now() - timestamp
  return age >= -60_000 && age <= SCORE_FLOW_TTL_MS
}

export function loadChallengeScoreFlowState(userId: string | null | undefined): ChallengeScoreFlowState | null {
  const id = normalizedUserId(userId)
  const key = storageKey(CHALLENGE_SCORE_FLOW_PREFIX, id)
  const parsed = readStoredValue(key) as Partial<ChallengeScoreFlowState> | null
  if (!parsed) return null

  const kind = parsed.kind === 'team' || parsed.kind === 'individual' ? parsed.kind : null
  const threadId = String(parsed.threadId || '').trim()
  const side = parsed.side === 'proposer' || parsed.side === 'challenged' ? parsed.side : undefined
  const participantEmail = String(parsed.participantEmail || '').trim().toLowerCase() || undefined
  const validTarget = kind === 'team' ? Boolean(side) : Boolean(participantEmail)
  if (parsed.version !== SCORE_FLOW_VERSION || parsed.userId !== id || !kind || !threadId || !validTarget || !isFresh(parsed.savedAt)) {
    removeStoredValue(key)
    return null
  }

  return {
    version: SCORE_FLOW_VERSION,
    userId: id,
    kind,
    threadId,
    side,
    participantEmail,
    activeHole: normalizedHoleNumber(parsed.activeHole),
    savedAt: Number(parsed.savedAt),
  }
}

export function saveChallengeScoreFlowState(
  userId: string | null | undefined,
  input: Omit<ChallengeScoreFlowState, 'version' | 'userId' | 'savedAt'>
): ChallengeScoreFlowState | null {
  const id = normalizedUserId(userId)
  if (!id || !String(input.threadId || '').trim()) return null

  const value: ChallengeScoreFlowState = {
    version: SCORE_FLOW_VERSION,
    userId: id,
    kind: input.kind,
    threadId: String(input.threadId).trim(),
    side: input.kind === 'team' ? input.side : undefined,
    participantEmail: input.kind === 'individual' ? String(input.participantEmail || '').trim().toLowerCase() || undefined : undefined,
    activeHole: normalizedHoleNumber(input.activeHole),
    savedAt: Date.now(),
  }

  if ((value.kind === 'team' && !value.side) || (value.kind === 'individual' && !value.participantEmail)) return null
  writeStoredValue(storageKey(CHALLENGE_SCORE_FLOW_PREFIX, id), value)
  return value
}

export function clearChallengeScoreFlowState(userId: string | null | undefined) {
  removeStoredValue(storageKey(CHALLENGE_SCORE_FLOW_PREFIX, userId))
}

export function loadSoloScoreFlowState(userId: string | null | undefined): SoloScoreFlowState | null {
  const id = normalizedUserId(userId)
  const key = storageKey(SOLO_SCORE_FLOW_PREFIX, id)
  const parsed = readStoredValue(key) as Partial<SoloScoreFlowState> | null
  if (!parsed) return null

  const date = String(parsed.date || '').trim()
  const state = String(parsed.state || '').trim().toUpperCase()
  const course = String(parsed.course || '').trim()
  const teeColor = String(parsed.teeColor || '').trim()
  if (parsed.version !== SCORE_FLOW_VERSION || parsed.userId !== id || !date || !state || !course || !teeColor || !isFresh(parsed.savedAt)) {
    removeStoredValue(key)
    return null
  }

  return {
    version: SCORE_FLOW_VERSION,
    userId: id,
    date,
    state,
    course,
    courseId: String(parsed.courseId || '').trim(),
    courseSearch: String(parsed.courseSearch || course).trim() || course,
    teeColor,
    activeHole: normalizedHoleNumber(parsed.activeHole),
    savedAt: Number(parsed.savedAt),
  }
}

export function saveSoloScoreFlowState(
  userId: string | null | undefined,
  input: Omit<SoloScoreFlowState, 'version' | 'userId' | 'savedAt'>
): SoloScoreFlowState | null {
  const id = normalizedUserId(userId)
  const date = String(input.date || '').trim()
  const state = String(input.state || '').trim().toUpperCase()
  const course = String(input.course || '').trim()
  const teeColor = String(input.teeColor || '').trim()
  if (!id || !date || !state || !course || !teeColor) return null

  const value: SoloScoreFlowState = {
    version: SCORE_FLOW_VERSION,
    userId: id,
    date,
    state,
    course,
    courseId: String(input.courseId || '').trim(),
    courseSearch: String(input.courseSearch || course).trim() || course,
    teeColor,
    activeHole: normalizedHoleNumber(input.activeHole),
    savedAt: Date.now(),
  }
  writeStoredValue(storageKey(SOLO_SCORE_FLOW_PREFIX, id), value)
  return value
}

export function clearSoloScoreFlowState(userId: string | null | undefined) {
  removeStoredValue(storageKey(SOLO_SCORE_FLOW_PREFIX, userId))
}


export function loadRoundEditScoreFlowState(userId: string | null | undefined): RoundEditScoreFlowState | null {
  const id = normalizedUserId(userId)
  const key = storageKey(ROUND_EDIT_SCORE_FLOW_PREFIX, id)
  const parsed = readStoredValue(key) as Partial<RoundEditScoreFlowState> | null
  if (!parsed) return null

  const roundId = String(parsed.roundId || '').trim()
  const side = parsed.side === 'solo' || parsed.side === 'team' || parsed.side === 'opponent' ? parsed.side : null
  if (parsed.version !== SCORE_FLOW_VERSION || parsed.userId !== id || !roundId || !side || !isFresh(parsed.savedAt)) {
    removeStoredValue(key)
    return null
  }

  return {
    version: SCORE_FLOW_VERSION,
    userId: id,
    roundId,
    side,
    activeHole: normalizedHoleNumber(parsed.activeHole),
    savedAt: Number(parsed.savedAt),
  }
}

export function saveRoundEditScoreFlowState(
  userId: string | null | undefined,
  input: Omit<RoundEditScoreFlowState, 'version' | 'userId' | 'savedAt'>
): RoundEditScoreFlowState | null {
  const id = normalizedUserId(userId)
  const roundId = String(input.roundId || '').trim()
  const side = input.side === 'solo' || input.side === 'team' || input.side === 'opponent' ? input.side : null
  if (!id || !roundId || !side) return null

  const value: RoundEditScoreFlowState = {
    version: SCORE_FLOW_VERSION,
    userId: id,
    roundId,
    side,
    activeHole: normalizedHoleNumber(input.activeHole),
    savedAt: Date.now(),
  }
  writeStoredValue(storageKey(ROUND_EDIT_SCORE_FLOW_PREFIX, id), value)
  return value
}

export function clearRoundEditScoreFlowState(userId: string | null | undefined) {
  removeStoredValue(storageKey(ROUND_EDIT_SCORE_FLOW_PREFIX, userId))
}
