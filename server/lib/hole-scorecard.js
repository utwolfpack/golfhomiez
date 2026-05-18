import { getPool } from '../db.js'
import { logError } from './logger.js'

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

export function buildDefaultHoleScorecard({ state = '', course = '', courseId = '' } = {}) {
  const seedSource = `${normalizeState(state)}|${normalizeText(course)}|${normalizeText(courseId)}`
  const random = createSeededRandom(seedSource)
  const parValues = shuffleWithRandom(DEFAULT_PAR_VALUES, random)
  const strokeIndexes = shuffleWithRandom(DEFAULT_STROKE_INDEXES, random)
  const holes = parValues.map((par, index) => ({
    hole: index + 1,
    par,
    yards: defaultYardsForPar(par, random),
    strokeIndex: strokeIndexes[index] || index + 1,
    score: par,
    scoreProvided: false,
  }))

  return {
    source: 'generated-defaults',
    state: normalizeState(state),
    course: normalizeText(course),
    courseId: normalizeText(courseId) || null,
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
          score: Number.isFinite(hole) ? Math.max(0, Math.trunc(hole)) : 0,
          scoreProvided: true,
        }
      }

      const holeNumber = Number(hole?.hole)
      const par = Number(hole?.par)
      const yards = Number(hole?.yards)
      const strokeIndex = Number(hole?.strokeIndex ?? hole?.stroke_index)
      const score = Number(hole?.score)

      return {
        hole: Number.isFinite(holeNumber) && holeNumber > 0 ? Math.min(18, Math.trunc(holeNumber)) : index + 1,
        par: Number.isFinite(par) && par > 0 ? Math.trunc(par) : null,
        yards: Number.isFinite(yards) && yards > 0 ? Math.trunc(yards) : null,
        strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : index + 1,
        score: Number.isFinite(score) && score >= 0 ? Math.trunc(score) : 0,
        scoreProvided: hole?.scoreProvided === false || hole?.score_provided === false ? false : true,
      }
    })

  return normalized.length ? normalized : null
}

async function tableExists(tableName) {
  const pool = getPool()
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName],
  )
  return Number(rows?.[0]?.count || 0) > 0
}

async function columnExists(tableName, columnName) {
  const pool = getPool()
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS count
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?`,
    [tableName, columnName],
  )
  return Number(rows?.[0]?.count || 0) > 0
}

async function loadStoredHoleScorecard({ state, course, courseId }) {
  if (!(await tableExists('golf_course_hole_scorecards'))) return null

  const pool = getPool()
  const hasStrokeIndex = await columnExists('golf_course_hole_scorecards', 'stroke_index')
  const params = []
  const predicates = []

  const cleanState = normalizeState(state)
  const cleanCourse = normalizeText(course)
  const cleanCourseId = normalizeText(courseId)

  if (cleanCourseId) {
    predicates.push('golf_course_id = ?')
    params.push(cleanCourseId)
  }

  if (cleanState && cleanCourse) {
    predicates.push('(UPPER(state) = ? AND LOWER(course_name) = LOWER(?))')
    params.push(cleanState, cleanCourse)
  }

  if (!predicates.length) return null

  const [rows] = await pool.execute(
    `SELECT hole_number, par, yards${hasStrokeIndex ? ', stroke_index' : ''}
       FROM golf_course_hole_scorecards
      WHERE ${predicates.join(' OR ')}
      ORDER BY hole_number ASC`,
    params,
  )

  if (!Array.isArray(rows) || rows.length !== 18) return null

  const holes = rows.map((row, index) => {
    const par = Number(row.par)
    const yards = Number(row.yards)
    const strokeIndex = Number(row.stroke_index)
    return {
      hole: Number(row.hole_number),
      par: Number.isFinite(par) && par > 0 ? par : 4,
      yards: Number.isFinite(yards) && yards > 0 ? yards : 0,
      strokeIndex: Number.isFinite(strokeIndex) && strokeIndex > 0 ? Math.min(18, Math.trunc(strokeIndex)) : index + 1,
      score: Number.isFinite(par) && par > 0 ? par : 4,
      scoreProvided: false,
    }
  })

  return {
    source: 'database',
    state: cleanState,
    course: cleanCourse,
    courseId: cleanCourseId || null,
    holes,
    parTotal: calculateParTotal(holes),
    scoreTotal: calculateHoleScoreTotal(holes),
  }
}

export async function getHoleScorecardForCourse({ state = '', course = '', courseId = '' } = {}) {
  try {
    const stored = await loadStoredHoleScorecard({ state, course, courseId })
    if (stored) return stored
  } catch (error) {
    logError('Failed to load stored golf course hole scorecard', { error, state, course, courseId })
  }

  return buildDefaultHoleScorecard({ state, course, courseId })
}
