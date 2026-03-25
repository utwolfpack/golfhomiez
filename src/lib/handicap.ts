import { calculateHandicapDifferential, calculateHandicapIndex, getCourseDetails } from '../data/courseDetails'
import type { ScoreEntry, SoloScoreEntry } from '../types'

type HandicapRound = {
  id: string
  date: string
  state: string
  course: string
  roundScore: number
  differential: number | null
  courseRating: number | null
  slopeRating: number | null
  included: boolean
}

export type HandicapStats = {
  handicap: number | null
  roundsUsed: number
  soloRounds: number
  ratedRounds: number
  differentialsUsed: number
  formulaText: string
  consideredRounds: HandicapRound[]
}

function isLegacySoloShape(score: any) {
  return score && (score.mode === 'solo' || (score.roundScore != null && score.teamTotal == null && score.opponentTotal == null))
}

function isSoloScore(score: ScoreEntry | any): score is SoloScoreEntry {
  return isLegacySoloShape(score)
}

function resolveRoundRating(score: any) {
  const explicitCourseRating = Number(score?.courseRating)
  const explicitSlopeRating = Number(score?.slopeRating)

  if (Number.isFinite(explicitCourseRating) && Number.isFinite(explicitSlopeRating) && explicitSlopeRating > 0) {
    return { courseRating: explicitCourseRating, slopeRating: explicitSlopeRating }
  }

  const details = getCourseDetails(String(score?.state || ''), String(score?.course || ''))
  if (!details) return null
  return { courseRating: details.courseRating, slopeRating: details.slopeRating }
}

function sortNewestFirst(scores: any[]) {
  return [...scores].sort((a, b) => {
    const dateCompare = String(b?.date || '').localeCompare(String(a?.date || ''))
    if (dateCompare !== 0) return dateCompare
    return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))
  })
}

function resolveDifferentialsUsedCount(ratedRounds: number) {
  if (ratedRounds >= 20) return 8
  if (ratedRounds >= 16) return 6
  if (ratedRounds >= 12) return 4
  if (ratedRounds >= 8) return 2
  if (ratedRounds >= 1) return 1
  return 0
}

export function calculateHandicapFromScores(scores: ScoreEntry[]): HandicapStats {
  const soloScores = sortNewestFirst(scores.filter(isSoloScore as any))
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
        included: false,
      }
    })

  const ratedRounds = consideredRounds.filter((round) => round.differential != null)
  const differentials = ratedRounds.map((round) => round.differential as number)
  const handicap = calculateHandicapIndex(differentials)
  const differentialsUsed = resolveDifferentialsUsedCount(differentials.length)
  const includedIds = new Set(
    [...ratedRounds]
      .sort((a, b) => (a.differential as number) - (b.differential as number))
      .slice(0, differentialsUsed)
      .map((round) => round.id)
  )

  for (const round of consideredRounds) {
    round.included = includedIds.has(round.id)
  }

  const formulaText = ratedRounds.length
    ? `Using the lowest ${differentialsUsed} differential${differentialsUsed === 1 ? '' : 's'} from ${ratedRounds.length} rated solo round${ratedRounds.length === 1 ? '' : 's'} in the current filtered set (up to the 20 most recent).`
    : 'No rated solo rounds are available in the current filtered set yet.'

  return {
    handicap,
    roundsUsed: ratedRounds.length,
    soloRounds: soloScores.length,
    ratedRounds: ratedRounds.length,
    differentialsUsed,
    formulaText,
    consideredRounds,
  }
}
