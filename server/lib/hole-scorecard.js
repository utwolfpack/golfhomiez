import { getGolfbertCourseHoles } from './golfbert-client.js'
import { normalizeTeeColor } from './tee-colors.js'

const DEFAULT_PAR_VALUES = [3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5]
const DEFAULT_STROKE_INDEXES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeState(value) {
  return normalizeText(value).toUpperCase()
}

function hashString(value) {
  let hash = 2166136261
  const text = String(value || '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createSeededRandom(seedSource) {
  let seed = hashString(seedSource) || 1
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223
    return (seed >>> 0) / 4294967296
  }
}

function shuffleWithRandom(values, random) {
  const next = [...values]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = next[index]
    next[index] = next[swapIndex]
    next[swapIndex] = current
  }
  return next
}

function defaultYardsForPar(par, random) {
  if (par === 3) return 115 + Math.floor(random() * 95)
  if (par === 5) return 470 + Math.floor(random() * 110)
  return 315 + Math.floor(random() * 110)
}

export function calculateHoleScoreTotal(holes) {
  if (!Array.isArray(holes)) return 0
  return holes.reduce((sum, hole) => {
    if (typeof hole === 'number') return sum + (Number.isFinite(hole) ? hole : 0)
    const score = Number(hole?.score)
    return sum + (Number.isFinite(score) ? score : 0)
  }, 0)
}

export function calculateParTotal(holes) {
  if (!Array.isArray(holes)) return 0
  return holes.reduce((sum, hole) => {
    const par = Number(hole?.par)
    return sum + (Number.isFinite(par) ? par : 0)
  }, 0)
}

export function buildDefaultHoleScorecard({ state = '', course = '', courseId = '', teeColor = 'white' } = {}) {
  const selectedTeeColor = normalizeTeeColor(teeColor)
  const seedSource = `${normalizeState(state)}|${normalizeText(course)}|${normalizeText(courseId)}|${selectedTeeColor}`
  const random = createSeededRandom(seedSource)
  const parValues = shuffleWithRandom(DEFAULT_PAR_VALUES, random)
  const strokeIndexes = shuffleWithRandom(DEFAULT_STROKE_INDEXES, random)
  const holes = parValues.map((par, index) => ({
    hole: index + 1,
    par,
    yards: defaultYardsForPar(par, random),
    strokeIndex: strokeIndexes[index] || index + 1,
    teeColor: selectedTeeColor,
    teeBoxType: selectedTeeColor,
    score: par,
    scoreProvided: false,
  }))

  return {
    source: 'client-placeholder',
    state: normalizeState(state),
    course: normalizeText(course),
    courseId: normalizeText(courseId) || null,
    teeColor: selectedTeeColor,
    holes,
    parTotal: calculateParTotal(holes),
    scoreTotal: calculateHoleScoreTotal(holes),
  }
}

export function normalizeHoleScorePayload(holes) {
  if (!Array.isArray(holes)) return null

  const normalized = holes
    .slice(0, 18)
    .map((hole, index) => {
      if (typeof hole === 'number') {
        return {
          hole: index + 1,
          par: null,
          yards: null,
          strokeIndex: index + 1,
          teeColor: 'white',
          teeBoxType: 'white',
          distanceToFlagYards: null,
          flagLatitude: null,
          flagLongitude: null,
          score: Number.isFinite(hole) ? Math.max(0, Math.trunc(hole)) : 0,
          scoreProvided: true,
        }
      }

      const holeNumber = Number(hole?.hole)
      const par = Number(hole?.par)
      const yards = Number(hole?.yards)
      const strokeIndex = Number(hole?.strokeIndex ?? hole?.stroke_index)
      const distanceToFlagYards = Number(hole?.distanceToFlagYards ?? hole?.distance_to_flag_yards)
      const teeColor = normalizeTeeColor(hole?.teeColor ?? hole?.tee_color)
      const teeBoxType = normalizeText(hole?.teeBoxType ?? hole?.tee_box_type ?? teeColor) || teeColor
      const flagLatitude = Number(hole?.flagLatitude ?? hole?.flag_latitude)
      const flagLongitude = Number(hole?.flagLongitude ?? hole?.flag_longitude)
      const score = Number(hole?.score)

      return {
        hole: Number.isFinite(holeNumber) && holeNumber > 0 ? Math.min(18, Math.trunc(holeNumber)) : index + 1,
        par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : null,
        yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : null,
        strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : index + 1,
        teeColor,
        teeBoxType,
        distanceToFlagYards: Number.isFinite(distanceToFlagYards) && distanceToFlagYards >= 0 ? Math.trunc(distanceToFlagYards) : null,
        flagLatitude: Number.isFinite(flagLatitude) ? flagLatitude : null,
        flagLongitude: Number.isFinite(flagLongitude) ? flagLongitude : null,
        score: Number.isFinite(score) && score >= 0 ? Math.trunc(score) : 0,
        scoreProvided: hole?.scoreProvided === false || hole?.score_provided === false ? false : true,
      }
    })

  return normalized.length ? normalized : null
}

export async function getHoleScorecardForCourse({ state = '', course = '', courseId = '', golferLatitude = null, golferLongitude = null, teeColor = 'white' } = {}) {
  const selectedTeeColor = normalizeTeeColor(teeColor)
  const result = await getGolfbertCourseHoles({ state, course, courseId, golferLatitude, golferLongitude, teeColor: selectedTeeColor })
  const holes = result.holes.map((hole) => ({
    ...hole,
    score: Number.isFinite(Number(hole.par)) && Number(hole.par) > 0 ? Number(hole.par) : 0,
    scoreProvided: false,
  }))

  return {
    source: 'golfbert-api',
    state: normalizeState(result.course?.state || result.course?.state_code || state),
    course: normalizeText(result.course?.name || course),
    courseId: normalizeText(result.course?.id || courseId) || null,
    teeColor: result.teeColor || selectedTeeColor,
    availableTeeColors: result.availableTeeColors || [],
    holes,
    parTotal: calculateParTotal(holes),
    scoreTotal: calculateHoleScoreTotal(holes),
  }
}
