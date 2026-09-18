import type { ScoreEntry } from '../types'

type HoleStatusPart = {
  label: string
  provided: number
  total: number
}

export type IncompleteRoundStatus = {
  incomplete: boolean
  label: string
  parts: HoleStatusPart[]
}

function parseHoleInput(input: unknown): unknown {
  if (typeof input !== 'string') return input
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function readHoleScores(record: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = parseHoleInput(record[key])
    if (Array.isArray(value) && value.length > 0) return value
  }

  return null
}

function hasExplicitProvidedFlag(record: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(record, 'scoreProvided') || Object.prototype.hasOwnProperty.call(record, 'score_provided')
}

function flagIsProvided(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function holeHasProvidedScore(hole: unknown) {
  if (typeof hole === 'number') return Number.isFinite(hole)
  if (!hole || typeof hole !== 'object') return false

  const record = hole as Record<string, unknown>
  if (hasExplicitProvidedFlag(record)) return flagIsProvided(record.scoreProvided ?? record.score_provided)
  return record.score !== undefined && record.score !== null && record.score !== '' && Number.isFinite(Number(record.score))
}

function positiveHoleCount(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  const count = Math.trunc(numeric)
  return count > 0 && count <= 18 ? count : null
}

function highestHoleNumber(holes: unknown[] | null) {
  if (!Array.isArray(holes)) return null
  let highest = 0
  holes.forEach((hole, index) => {
    if (typeof hole === 'number') {
      highest = Math.max(highest, index + 1)
      return
    }
    if (!hole || typeof hole !== 'object') return
    const record = hole as Record<string, unknown>
    const holeNumber = Number(record.hole ?? record.holeNumber ?? record.hole_number ?? index + 1)
    if (Number.isFinite(holeNumber) && holeNumber > 0) highest = Math.max(highest, Math.trunc(holeNumber))
  })
  return highest || null
}

/**
 * Resolve the number of holes that make up a complete round for the selected
 * course. Newer score payloads may expose an explicit course hole count. For
 * existing scores, course par and the stored scorecard shape provide a safe
 * fallback so a complete nine-hole course is not incorrectly treated as an
 * incomplete 18-hole round.
 */
export function resolveExpectedRoundHoleCount(record: Record<string, unknown>, holes: unknown[] | null) {
  for (const key of ['courseHoleCount', 'course_hole_count', 'holesCount', 'holes_count']) {
    const explicit = positiveHoleCount(record[key])
    if (explicit) return explicit
  }

  const highestHole = highestHoleNumber(holes)
  if (highestHole && highestHole > 9) return Math.min(18, highestHole)

  const coursePar = Number(record.coursePar ?? record.course_par ?? record.parTotal ?? record.par_total)
  if (Number.isFinite(coursePar) && coursePar > 0) {
    // Nine-hole courses are normally par 27-36 (occasionally a little higher),
    // while an 18-hole layout is well above this boundary.
    if (coursePar <= 45 && (!highestHole || highestHole <= 9)) return 9
    if (coursePar > 45) return 18
  }

  if (Array.isArray(holes) && holes.length >= 18) return 18

  // Legacy payloads without enough course metadata historically represented
  // 18-hole rounds, so preserve that conservative fallback.
  return 18
}

function scorePart(label: string, holes: unknown[] | null, total: number): HoleStatusPart | null {
  if (!Array.isArray(holes) || holes.length === 0) return null
  const provided = holes.filter(holeHasProvidedScore).length
  if (provided <= 0 || provided >= total) return null
  return { label, provided, total }
}

export function getIncompleteRoundStatus(round: ScoreEntry | Record<string, unknown> | null | undefined): IncompleteRoundStatus {
  if (!round) return { incomplete: false, label: '', parts: [] }

  const record = round as Record<string, unknown>
  const mode = record.mode === 'solo' || (record.roundScore != null && !record.team && !record.opponentTeam) ? 'solo' : 'team'
  const teamHoles = readHoleScores(record, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']) ?? null
  const opponentHoles = mode === 'team'
    ? readHoleScores(record, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']) ?? null
    : null
  const expectedHoleCount = resolveExpectedRoundHoleCount(record, teamHoles || opponentHoles)

  const parts = [
    scorePart(mode === 'solo' ? 'Round' : 'Team', teamHoles, expectedHoleCount),
    mode === 'team' ? scorePart('Opponent', opponentHoles, expectedHoleCount) : null,
  ].filter(Boolean) as HoleStatusPart[]

  if (!parts.length) return { incomplete: false, label: '', parts: [] }

  return {
    incomplete: true,
    label: parts.map((part) => `${part.label} ${part.provided}/${part.total}`).join(' • '),
    parts,
  }
}
