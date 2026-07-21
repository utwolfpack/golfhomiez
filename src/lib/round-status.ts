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

function scorePart(label: string, holes: unknown[] | null): HoleStatusPart | null {
  if (!Array.isArray(holes) || holes.length === 0) return null
  const total = Math.max(18, holes.length)
  const provided = holes.filter(holeHasProvidedScore).length
  if (provided <= 0 || provided >= total) return null
  return { label, provided, total }
}

export function getIncompleteRoundStatus(round: ScoreEntry | Record<string, unknown> | null | undefined): IncompleteRoundStatus {
  if (!round) return { incomplete: false, label: '', parts: [] }

  const record = round as Record<string, unknown>
  const mode = record.mode === 'solo' || (record.roundScore != null && !record.team && !record.opponentTeam) ? 'solo' : 'team'
  const parts = [
    scorePart(mode === 'solo' ? 'Round' : 'Team', readHoleScores(record, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']) ?? null),
    mode === 'team' ? scorePart('Opponent', readHoleScores(record, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']) ?? null) : null,
  ].filter(Boolean) as HoleStatusPart[]

  if (!parts.length) return { incomplete: false, label: '', parts: [] }

  return {
    incomplete: true,
    label: parts.map((part) => `${part.label} ${part.provided}/${part.total}`).join(' • '),
    parts,
  }
}
