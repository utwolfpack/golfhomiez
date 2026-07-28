import type { HoleScoreDetail } from '../types'
import { normalizeTeeColor } from './tee-colors'

const DEFAULT_PAR_VALUES = [3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5]
const DEFAULT_STROKE_INDEXES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
const EARTH_RADIUS_YARDS = 6967410

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

function hasScoreProvidedFlag(record: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(record, 'scoreProvided') || Object.prototype.hasOwnProperty.call(record, 'score_provided')
}

function finiteNumber(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function optionalNumberField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = finiteNumber(record[key])
      if (value != null) return value
    }
  }
  return null
}

export function calculateDistanceYards(latitudeA: unknown, longitudeA: unknown, latitudeB: unknown, longitudeB: unknown) {
  const lat1 = finiteNumber(latitudeA)
  const lon1 = finiteNumber(longitudeA)
  const lat2 = finiteNumber(latitudeB)
  const lon2 = finiteNumber(longitudeB)
  if ([lat1, lon1, lat2, lon2].some((value) => value == null)) return null

  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const dLat = toRadians((lat2 as number) - (lat1 as number))
  const dLon = toRadians((lon2 as number) - (lon1 as number))
  const startLat = toRadians(lat1 as number)
  const endLat = toRadians(lat2 as number)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(EARTH_RADIUS_YARDS * c)
}

export function buildClientDefaultHoleScorecard(state = '', course = '', teeColor = 'white'): HoleScoreDetail[] {
  const selectedTeeColor = normalizeTeeColor(teeColor)
  const random = createSeededRandom(`${String(state).toUpperCase()}|${course}|${selectedTeeColor}`)
  const strokeIndexes = shuffleWithRandom(DEFAULT_STROKE_INDEXES, random)
  return shuffleWithRandom(DEFAULT_PAR_VALUES, random).map((par, index) => ({
    hole: index + 1,
    par,
    yards: yardsForPar(par, random),
    strokeIndex: strokeIndexes[index] || index + 1,
    teeColor: selectedTeeColor,
    teeBoxType: selectedTeeColor,
    score: null,
    scoreProvided: false,
  }))
}

export function normalizeHoleScorecard(holes: unknown, fallbackState = '', fallbackCourse = '', fallbackTeeColor = 'white'): HoleScoreDetail[] {
  if (!Array.isArray(holes)) return buildClientDefaultHoleScorecard(fallbackState, fallbackCourse, fallbackTeeColor)

  const selectedTeeColor = normalizeTeeColor(fallbackTeeColor)

  const normalized = holes.slice(0, 18).map((hole, index) => {
    if (typeof hole === 'number') {
      const score = Number.isFinite(hole) ? Math.max(0, Math.trunc(hole)) : 0
      return { hole: index + 1, par: null, yards: null, strokeIndex: null, teeColor: selectedTeeColor, teeBoxType: selectedTeeColor, distanceToFrontYards: null, distanceToCenterYards: null, distanceToBackYards: null, distanceToFlagYards: null, frontLatitude: null, frontLongitude: null, centerLatitude: null, centerLongitude: null, backLatitude: null, backLongitude: null, flagLatitude: null, flagLongitude: null, score, scoreProvided: true }
    }

    const record = hole as Record<string, unknown>
    const holeNumber = Number(record.hole)
    const par = Number(record.par)
    const yards = Number(record.yards)
    const strokeIndex = Number(record.strokeIndex ?? record.stroke_index)
    const distanceToFrontYards = Number(record.distanceToFrontYards ?? record.distance_to_front_yards)
    const distanceToCenterYards = Number(record.distanceToCenterYards ?? record.distance_to_center_yards)
    const distanceToBackYards = Number(record.distanceToBackYards ?? record.distance_to_back_yards)
    const distanceToFlagYards = Number(record.distanceToFlagYards ?? record.distance_to_flag_yards)
    const teeColor = normalizeTeeColor(record.teeColor ?? record.tee_color ?? selectedTeeColor)
    const teeBoxType = String(record.teeBoxType ?? record.tee_box_type ?? teeColor ?? '').trim() || teeColor
    const rawScore = record.score
    const hasScoreValue = rawScore !== undefined && rawScore !== null && rawScore !== ''
    const score = hasScoreValue ? Number(rawScore) : Number.NaN
    const explicitScoreProvided = hasScoreProvidedFlag(record)
    const scoreProvided = explicitScoreProvided
      ? isProvided(record.scoreProvided ?? record.score_provided)
      : hasScoreValue && Number.isFinite(score) && score >= 0

    return {
      hole: Number.isFinite(holeNumber) && holeNumber > 0 ? Math.min(18, Math.trunc(holeNumber)) : index + 1,
      par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : null,
      yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : null,
      strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : null,
      teeColor,
      teeBoxType,
      distanceToFrontYards: Number.isFinite(distanceToFrontYards) && distanceToFrontYards >= 0 ? Math.trunc(distanceToFrontYards) : null,
      distanceToCenterYards: Number.isFinite(distanceToCenterYards) && distanceToCenterYards >= 0 ? Math.trunc(distanceToCenterYards) : null,
      distanceToBackYards: Number.isFinite(distanceToBackYards) && distanceToBackYards >= 0 ? Math.trunc(distanceToBackYards) : null,
      distanceToFlagYards: Number.isFinite(distanceToFlagYards) && distanceToFlagYards >= 0 ? Math.trunc(distanceToFlagYards) : null,
      frontLatitude: optionalNumberField(record, 'frontLatitude', 'front_latitude'),
      frontLongitude: optionalNumberField(record, 'frontLongitude', 'front_longitude'),
      centerLatitude: optionalNumberField(record, 'centerLatitude', 'center_latitude'),
      centerLongitude: optionalNumberField(record, 'centerLongitude', 'center_longitude'),
      backLatitude: optionalNumberField(record, 'backLatitude', 'back_latitude'),
      backLongitude: optionalNumberField(record, 'backLongitude', 'back_longitude'),
      flagLatitude: Number.isFinite(Number(record.flagLatitude ?? record.flag_latitude)) ? Number(record.flagLatitude ?? record.flag_latitude) : null,
      flagLongitude: Number.isFinite(Number(record.flagLongitude ?? record.flag_longitude)) ? Number(record.flagLongitude ?? record.flag_longitude) : null,
      score: hasScoreValue && Number.isFinite(score) && score >= 0 ? Math.trunc(score) : (scoreProvided ? (Number.isFinite(par) && par > 0 ? Math.trunc(par) : 0) : null),
      scoreProvided,
    }
  })

  return normalized.length ? normalized : buildClientDefaultHoleScorecard(fallbackState, fallbackCourse, selectedTeeColor)
}

function normalizePartialProvidedHoleScore(hole: unknown, index: number): HoleScoreDetail | null {
  if (typeof hole === 'number') {
    return {
      hole: index + 1,
      par: null,
      yards: null,
      strokeIndex: null,
      teeColor: 'white',
      teeBoxType: 'white',
      distanceToFrontYards: null,
      distanceToCenterYards: null,
      distanceToBackYards: null,
      distanceToFlagYards: null,
      frontLatitude: null,
      frontLongitude: null,
      centerLatitude: null,
      centerLongitude: null,
      backLatitude: null,
      backLongitude: null,
      flagLatitude: null,
      flagLongitude: null,
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
  const distanceToFrontYards = Number(record.distanceToFrontYards ?? record.distance_to_front_yards)
  const distanceToCenterYards = Number(record.distanceToCenterYards ?? record.distance_to_center_yards)
  const distanceToBackYards = Number(record.distanceToBackYards ?? record.distance_to_back_yards)
  const distanceToFlagYards = Number(record.distanceToFlagYards ?? record.distance_to_flag_yards)
  const teeColor = normalizeTeeColor(record.teeColor ?? record.tee_color)
  const teeBoxType = String(record.teeBoxType ?? record.tee_box_type ?? teeColor ?? '').trim() || teeColor
  const frontLatitude = optionalNumberField(record, 'frontLatitude', 'front_latitude')
  const frontLongitude = optionalNumberField(record, 'frontLongitude', 'front_longitude')
  const centerLatitude = optionalNumberField(record, 'centerLatitude', 'center_latitude')
  const centerLongitude = optionalNumberField(record, 'centerLongitude', 'center_longitude')
  const backLatitude = optionalNumberField(record, 'backLatitude', 'back_latitude')
  const backLongitude = optionalNumberField(record, 'backLongitude', 'back_longitude')
  const flagLatitude = Number(record.flagLatitude ?? record.flag_latitude)
  const flagLongitude = Number(record.flagLongitude ?? record.flag_longitude)
  const rawScore = record.score
  const score = Number(rawScore)
  const scoreProvidedValue = record.scoreProvided ?? record.score_provided
  const provided = isProvided(scoreProvidedValue)
  const hasScoreValue = rawScore !== undefined && rawScore !== null && rawScore !== ''

  if (!Number.isFinite(holeNumber) || holeNumber < 1 || holeNumber > 18) return null
  if (hasScoreProvidedFlag(record) && !provided) return null
  if (!hasScoreValue || !Number.isFinite(score) || score < 0) return null

  return {
    hole: Math.trunc(holeNumber),
    par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : null,
    yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : null,
    strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : null,
    teeColor,
    teeBoxType,
    distanceToFrontYards: Number.isFinite(distanceToFrontYards) && distanceToFrontYards >= 0 ? Math.trunc(distanceToFrontYards) : null,
    distanceToCenterYards: Number.isFinite(distanceToCenterYards) && distanceToCenterYards >= 0 ? Math.trunc(distanceToCenterYards) : null,
    distanceToBackYards: Number.isFinite(distanceToBackYards) && distanceToBackYards >= 0 ? Math.trunc(distanceToBackYards) : null,
    distanceToFlagYards: Number.isFinite(distanceToFlagYards) && distanceToFlagYards >= 0 ? Math.trunc(distanceToFlagYards) : null,
    frontLatitude,
    frontLongitude,
    centerLatitude,
    centerLongitude,
    backLatitude,
    backLongitude,
    flagLatitude: Number.isFinite(flagLatitude) ? flagLatitude : null,
    flagLongitude: Number.isFinite(flagLongitude) ? flagLongitude : null,
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
      par: Number.isFinite(Number(saved.par)) && Number(saved.par) > 0 ? saved.par : hole.par,
      yards: Number.isFinite(Number(saved.yards)) && Number(saved.yards) > 0 ? saved.yards : hole.yards,
      strokeIndex: Number.isFinite(saved.strokeIndex) && Number(saved.strokeIndex) > 0 ? saved.strokeIndex : hole.strokeIndex,
      teeColor: saved.teeColor || hole.teeColor,
      teeBoxType: saved.teeBoxType || hole.teeBoxType,
      distanceToFrontYards: Number.isFinite(saved.distanceToFrontYards) && Number(saved.distanceToFrontYards) >= 0 ? saved.distanceToFrontYards : hole.distanceToFrontYards,
      distanceToCenterYards: Number.isFinite(saved.distanceToCenterYards) && Number(saved.distanceToCenterYards) >= 0 ? saved.distanceToCenterYards : hole.distanceToCenterYards,
      distanceToBackYards: Number.isFinite(saved.distanceToBackYards) && Number(saved.distanceToBackYards) >= 0 ? saved.distanceToBackYards : hole.distanceToBackYards,
      distanceToFlagYards: Number.isFinite(saved.distanceToFlagYards) && Number(saved.distanceToFlagYards) >= 0 ? saved.distanceToFlagYards : hole.distanceToFlagYards,
      frontLatitude: Number.isFinite(Number(saved.frontLatitude)) ? saved.frontLatitude : hole.frontLatitude,
      frontLongitude: Number.isFinite(Number(saved.frontLongitude)) ? saved.frontLongitude : hole.frontLongitude,
      centerLatitude: Number.isFinite(Number(saved.centerLatitude)) ? saved.centerLatitude : hole.centerLatitude,
      centerLongitude: Number.isFinite(Number(saved.centerLongitude)) ? saved.centerLongitude : hole.centerLongitude,
      backLatitude: Number.isFinite(Number(saved.backLatitude)) ? saved.backLatitude : hole.backLatitude,
      backLongitude: Number.isFinite(Number(saved.backLongitude)) ? saved.backLongitude : hole.backLongitude,
      flagLatitude: Number.isFinite(Number(saved.flagLatitude)) ? saved.flagLatitude : hole.flagLatitude,
      flagLongitude: Number.isFinite(Number(saved.flagLongitude)) ? saved.flagLongitude : hole.flagLongitude,
      score: Number.isFinite(Number(saved.score)) && Number(saved.score) >= 0 ? Number(saved.score) : hole.score,
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

export function resetHoleScore(holes: HoleScoreDetail[], holeNumber: number): HoleScoreDetail[] {
  return holes.map((hole) => (
    hole.hole === holeNumber ? { ...hole, score: null, scoreProvided: false } : hole
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
  return holes.reduce((sum, hole) => sum + (Number.isFinite(Number(hole.score)) ? Number(hole.score) : 0), 0)
}

export function providedHoleScoreTotal(holes: HoleScoreDetail[]) {
  return holes
    .filter((hole) => hole.scoreProvided)
    .reduce((sum, hole) => sum + (Number.isFinite(Number(hole.score)) ? Number(hole.score) : 0), 0)
}

export function holeParTotal(holes: HoleScoreDetail[]) {
  return holes.reduce((sum, hole) => {
    const par = Number(hole.par)
    return sum + (Number.isFinite(par) ? par : 0)
  }, 0)
}

export function holeScoreRelativeToPar(hole: Pick<HoleScoreDetail, 'par' | 'score'>) {
  const par = Number(hole.par)
  const score = Number(hole.score)
  if (hole.score == null || !Number.isFinite(par) || !Number.isFinite(score)) return null
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
