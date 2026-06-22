import type { ScoreEntry, SoloScoreEntry } from '../types'
import { getIncompleteRoundStatus } from './round-status'

type RatingSource = 'saved' | 'missing'

type HandicapRound = {
  id: string
  date: string
  state: string
  course: string
  roundScore: number
  differential: number | null
  courseRating: number | null
  slopeRating: number | null
  ratingSource: RatingSource
  included: boolean
}

export type HandicapStats = {
  handicap: number | null
  roundsUsed: number
  soloRounds: number
  ratedRounds: number
  differentialsUsed: number
  adjustment: number
  formulaText: string
  consideredRounds: HandicapRound[]
}

function calculateHandicapDifferential(score: number, courseRating: number, slopeRating: number) {
  if (!Number.isFinite(score) || !Number.isFinite(courseRating) || !Number.isFinite(slopeRating) || slopeRating <= 0) return null
  return Math.round((((score - courseRating) * 113) / slopeRating) * 10) / 10
}

type HandicapRule = { usedCount: number; adjustment: number; minimumRequired: number }

function resolveHandicapRule(ratedRounds: number): HandicapRule {
  if (ratedRounds < 3) return { usedCount: 0, adjustment: 0, minimumRequired: 3 }
  if (ratedRounds === 3) return { usedCount: 1, adjustment: -2, minimumRequired: 3 }
  if (ratedRounds === 4) return { usedCount: 1, adjustment: -1, minimumRequired: 3 }
  if (ratedRounds === 5) return { usedCount: 1, adjustment: 0, minimumRequired: 3 }
  if (ratedRounds === 6) return { usedCount: 2, adjustment: -1, minimumRequired: 3 }
  if (ratedRounds <= 8) return { usedCount: 2, adjustment: 0, minimumRequired: 3 }
  if (ratedRounds <= 11) return { usedCount: 3, adjustment: 0, minimumRequired: 3 }
  if (ratedRounds <= 14) return { usedCount: 4, adjustment: 0, minimumRequired: 3 }
  if (ratedRounds <= 16) return { usedCount: 5, adjustment: 0, minimumRequired: 3 }
  if (ratedRounds <= 18) return { usedCount: 6, adjustment: 0, minimumRequired: 3 }
  if (ratedRounds === 19) return { usedCount: 7, adjustment: 0, minimumRequired: 3 }
  return { usedCount: 8, adjustment: 0, minimumRequired: 3 }
}

function calculateHandicapIndex(differentials: number[]) {
  const valid = differentials.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  const rule = resolveHandicapRule(valid.length)
  if (!rule.usedCount) return { handicap: null, usedCount: 0, adjustment: rule.adjustment }
  const used = valid.slice(0, rule.usedCount)
  const average = used.reduce((sum, value) => sum + value, 0) / used.length
  const adjusted = Math.max(0, average + rule.adjustment)
  return { handicap: Math.round(adjusted * 10) / 10, usedCount: rule.usedCount, adjustment: rule.adjustment }
}

function isLegacySoloShape(score: any) {
  return score && (score.mode === 'solo' || (score.roundScore != null && score.teamTotal == null && score.opponentTotal == null))
}

function isSoloScore(score: ScoreEntry | any): score is SoloScoreEntry {
  return isLegacySoloShape(score)
}

function readFiniteNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function resolveRoundRating(score: any) {
  const explicitCourseRating = readFiniteNumber(score?.courseRating)
  const explicitSlopeRating = readFiniteNumber(score?.slopeRating)

  if (explicitCourseRating != null && explicitSlopeRating != null && explicitSlopeRating > 0) {
    return { courseRating: explicitCourseRating, slopeRating: explicitSlopeRating, source: 'saved' as RatingSource }
  }

  return null
}

function sortNewestFirst(scores: any[]) {
  return [...scores].sort((a, b) => {
    const dateCompare = String(b?.date || '').localeCompare(String(a?.date || ''))
    if (dateCompare !== 0) return dateCompare
    return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))
  })
}

export function calculateHandicapFromScores(scores: ScoreEntry[]): HandicapStats {
  const allSoloScores = sortNewestFirst(scores.filter(isSoloScore as any))
  const soloScores = allSoloScores.filter((score) => !getIncompleteRoundStatus(score).incomplete)
  const recentSoloScores = soloScores.slice(0, 20)

  const consideredRounds = recentSoloScores
    .map((score: any) => {
      const rating = resolveRoundRating(score)
      const roundScore = Number(score?.roundScore)
      const differential = !rating || !Number.isFinite(roundScore)
        ? null
        : calculateHandicapDifferential(roundScore, rating.courseRating, rating.slopeRating)

      return {
        id: String(score?.id || `${score?.date || 'round'}-${score?.course || 'course'}`),
        date: String(score?.date || ''),
        state: String(score?.state || '').toUpperCase(),
        course: String(score?.course || ''),
        roundScore,
        differential: Number.isFinite(differential as number) ? Number(differential) : null,
        courseRating: rating?.courseRating ?? null,
        slopeRating: rating?.slopeRating ?? null,
        ratingSource: rating?.source ?? 'missing',
        included: false,
      }
    })

  const ratedRounds = consideredRounds.filter((round) => round.differential != null)
  const differentials = ratedRounds.map((round) => round.differential as number)
  const handicapResult = calculateHandicapIndex(differentials)
  const includedIds = new Set(
    [...ratedRounds]
      .sort((a, b) => (a.differential as number) - (b.differential as number))
      .slice(0, handicapResult.usedCount)
      .map((round) => round.id)
  )

  for (const round of consideredRounds) {
    round.included = includedIds.has(round.id)
  }

  const formulaText = ratedRounds.length >= 3
    ? `Using the lowest ${handicapResult.usedCount} differential${handicapResult.usedCount === 1 ? '' : 's'} from ${ratedRounds.length} rated solo round${ratedRounds.length === 1 ? '' : 's'} in the current filtered set (up to the 20 most recent)${handicapResult.adjustment ? `, then applying a ${handicapResult.adjustment.toFixed(1)} reduced-round adjustment` : ''}.`
    : `Need at least 3 rated solo rounds in the current filtered set to calculate a handicap. ${ratedRounds.length} rated round${ratedRounds.length === 1 ? '' : 's'} available.`

  return {
    handicap: handicapResult.handicap,
    roundsUsed: ratedRounds.length,
    soloRounds: allSoloScores.length,
    ratedRounds: ratedRounds.length,
    differentialsUsed: handicapResult.usedCount,
    adjustment: handicapResult.adjustment,
    formulaText,
    consideredRounds,
  }
}
