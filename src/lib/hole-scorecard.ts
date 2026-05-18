import type { HoleScoreDetail } from '../types'

const DEFAULT_PAR_VALUES = [3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5]
const DEFAULT_STROKE_INDEXES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createSeededRandom(seedSource: string) {
  let seed = hashString(seedSource) || 1
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223
    return (seed >>> 0) / 4294967296
  }
}

function shuffleWithRandom<T>(values: T[], random: () => number) {
  const next = [...values]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = next[index]
    next[index] = next[swapIndex]
    next[swapIndex] = current
  }
  return next
}

function yardsForPar(par: number, random: () => number) {
  if (par === 3) return 115 + Math.floor(random() * 95)
  if (par === 5) return 470 + Math.floor(random() * 110)
  return 315 + Math.floor(random() * 110)
}

function isProvided(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export function buildClientDefaultHoleScorecard(state = '', course = ''): HoleScoreDetail[] {
  const random = createSeededRandom(`${String(state).toUpperCase()}|${course}`)
  const strokeIndexes = shuffleWithRandom(DEFAULT_STROKE_INDEXES, random)
  return shuffleWithRandom(DEFAULT_PAR_VALUES, random).map((par, index) => ({
    hole: index + 1,
    par,
    yards: yardsForPar(par, random),
    strokeIndex: strokeIndexes[index] || index + 1,
    score: par,
    scoreProvided: false,
  }))
}

export function normalizeHoleScorecard(holes: unknown, fallbackState = '', fallbackCourse = ''): HoleScoreDetail[] {
  if (!Array.isArray(holes)) return buildClientDefaultHoleScorecard(fallbackState, fallbackCourse)

  const normalized = holes.slice(0, 18).map((hole, index) => {
    if (typeof hole === 'number') {
      const score = Number.isFinite(hole) ? Math.max(0, Math.trunc(hole)) : 0
      return { hole: index + 1, par: 4, yards: 0, strokeIndex: index + 1, score, scoreProvided: true }
    }

    const record = hole as Record<string, unknown>
    const holeNumber = Number(record.hole)
    const par = Number(record.par)
    const yards = Number(record.yards)
    const strokeIndex = Number(record.strokeIndex ?? record.stroke_index)
    const score = Number(record.score)

    return {
      hole: Number.isFinite(holeNumber) && holeNumber > 0 ? Math.min(18, Math.trunc(holeNumber)) : index + 1,
      par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : 4,
      yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : 0,
      strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : index + 1,
      score: Number.isFinite(score) && score >= 0 ? Math.trunc(score) : (Number.isFinite(par) && par > 0 ? Math.trunc(par) : 4),
      scoreProvided: isProvided(record.scoreProvided ?? record.score_provided),
    }
  })

  return normalized.length === 18 ? normalized : buildClientDefaultHoleScorecard(fallbackState, fallbackCourse)
}

function normalizePartialProvidedHoleScore(hole: unknown, index: number): HoleScoreDetail | null {
  if (typeof hole === 'number') {
    return {
      hole: index + 1,
      par: 4,
      yards: 0,
      strokeIndex: index + 1,
      score: Number.isFinite(hole) ? Math.max(0, Math.trunc(hole)) : 0,
      scoreProvided: true,
    }
  }

  if (!hole || typeof hole !== 'object') return null
  const record = hole as Record<string, unknown>
  const holeNumber = Number(record.hole ?? record.holeNumber ?? record.hole_number)
  const par = Number(record.par)
  const yards = Number(record.yards)
  const strokeIndex = Number(record.strokeIndex ?? record.stroke_index)
  const score = Number(record.score)

  if (!Number.isFinite(holeNumber) || holeNumber < 1 || holeNumber > 18) return null
  if (!Number.isFinite(score) || score < 0) return null

  return {
    hole: Math.trunc(holeNumber),
    par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : 4,
    yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : 0,
    strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : Math.trunc(holeNumber),
    score: Math.max(0, Math.trunc(score)),
    scoreProvided: true,
  }
}

export function mergeProvidedHoleScores(baseHoles: HoleScoreDetail[], savedHoles: unknown): HoleScoreDetail[] {
  if (!Array.isArray(savedHoles) || !savedHoles.length) return baseHoles

  const savedByHole = new Map<number, HoleScoreDetail>()
  savedHoles.forEach((savedHole, index) => {
    const normalized = normalizePartialProvidedHoleScore(savedHole, index)
    if (normalized) savedByHole.set(normalized.hole, normalized)
  })

  return baseHoles.map((hole) => {
    const saved = savedByHole.get(hole.hole)
    if (!saved) return hole
    return {
      ...hole,
      par: Number.isFinite(saved.par) && saved.par > 0 ? saved.par : hole.par,
      yards: Number.isFinite(saved.yards) && saved.yards > 0 ? saved.yards : hole.yards,
      strokeIndex: Number.isFinite(saved.strokeIndex) && saved.strokeIndex > 0 ? saved.strokeIndex : hole.strokeIndex,
      score: Number.isFinite(saved.score) && saved.score >= 0 ? saved.score : hole.score,
      scoreProvided: true,
    }
  })
}

export function updateHoleScore(holes: HoleScoreDetail[], holeNumber: number, score: number): HoleScoreDetail[] {
  const normalizedScore = Math.max(0, Math.trunc(score))
  return holes.map((hole) => (
    hole.hole === holeNumber ? { ...hole, score: normalizedScore, scoreProvided: true } : hole
  ))
}

export function missingHoleScoreNumbers(holes: HoleScoreDetail[]) {
  return holes
    .filter((hole) => !hole.scoreProvided)
    .map((hole) => hole.hole)
    .filter((hole) => Number.isFinite(hole))
}

export function allHoleScoresProvided(holes: HoleScoreDetail[]) {
  return holes.length === 18 && missingHoleScoreNumbers(holes).length === 0
}

export function holeScoreTotal(holes: HoleScoreDetail[]) {
  return holes.reduce((sum, hole) => sum + (Number.isFinite(hole.score) ? hole.score : 0), 0)
}

export function holeParTotal(holes: HoleScoreDetail[]) {
  return holes.reduce((sum, hole) => sum + (Number.isFinite(hole.par) ? hole.par : 0), 0)
}

export function holeScoreRelativeToPar(hole: Pick<HoleScoreDetail, 'par' | 'score'>) {
  const par = Number(hole.par)
  const score = Number(hole.score)
  if (!Number.isFinite(par) || !Number.isFinite(score)) return null
  return Math.trunc(score) - Math.trunc(par)
}

export function formatHoleScoreOutcome(hole: Pick<HoleScoreDetail, 'par' | 'score'>) {
  const relative = holeScoreRelativeToPar(hole)
  if (relative == null) return 'Score unavailable'
  if (relative <= -2) return 'Eagle'
  if (relative === -1) return 'Birdie'
  if (relative === 0) return 'Par'
  if (relative === 1) return 'Bogey'
  if (relative === 2) return 'Double-Bogey'
  if (relative === 3) return 'Triple-Bogey'
  return relative > 0 ? `+${relative}` : String(relative)
}

export function scoreOutcomeClassName(hole: Pick<HoleScoreDetail, 'par' | 'score'>) {
  const relative = holeScoreRelativeToPar(hole)
  if (relative == null) return 'roundHoleDetailPill--unknown'
  if (relative <= -2) return 'roundHoleDetailPill--eagleBetter'
  if (relative === -1) return 'roundHoleDetailPill--birdie'
  if (relative === 0) return 'roundHoleDetailPill--par'
  if (relative === 1) return 'roundHoleDetailPill--bogey'
  if (relative === 2) return 'roundHoleDetailPill--doubleBogey'
  return 'roundHoleDetailPill--tripleBogeyPlus'
}
