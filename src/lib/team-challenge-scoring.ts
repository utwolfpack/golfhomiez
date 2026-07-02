import type { HoleScoreDetail } from '../types'

export type TeamChallengeScoringType = 'stroke_play' | 'skins' | 'skins_push'

export const DEFAULT_TEAM_CHALLENGE_SCORING_TYPE: TeamChallengeScoringType = 'stroke_play'
export const DEFAULT_TEAM_CHALLENGE_POINTS_PER_HOLE = 1

export function normalizeTeamChallengeScoringType(value: unknown): TeamChallengeScoringType {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'skins') return 'skins'
  if (normalized === 'skins_push' || normalized === 'skinspush' || normalized === 'push_skins') return 'skins_push'
  return DEFAULT_TEAM_CHALLENGE_SCORING_TYPE
}

export function isSkinsTeamChallenge(value: unknown): boolean {
  const scoringType = normalizeTeamChallengeScoringType(value)
  return scoringType === 'skins' || scoringType === 'skins_push'
}

export function teamChallengeScoringTypeLabel(value: unknown): string {
  const scoringType = normalizeTeamChallengeScoringType(value)
  if (scoringType === 'skins') return 'Skins'
  if (scoringType === 'skins_push') return 'Skins - Push'
  return 'Standard team score'
}

export function normalizeTeamChallengePointsPerHole(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_TEAM_CHALLENGE_POINTS_PER_HOLE
  const points = Number(value)
  if (!Number.isFinite(points) || points <= 0) return DEFAULT_TEAM_CHALLENGE_POINTS_PER_HOLE
  return Math.round(points * 100) / 100
}

type PointSide = 'proposer' | 'challenged' | 'tie' | 'pending'

export type TeamChallengeHolePointResult = {
  hole: number
  winner: PointSide
  proposerScore: number | null
  challengedScore: number | null
  pointsAwarded: number
  carryoverAfterHole: number
}

export type TeamChallengePointSummary = {
  scoringType: TeamChallengeScoringType
  pointsPerHole: number
  proposerPoints: number
  challengedPoints: number
  proposerNetPoints: number
  challengedNetPoints: number
  completedHoles: number
  carryoverPoints: number
  holeResults: TeamChallengeHolePointResult[]
}

function scoreProvided(hole?: HoleScoreDetail | null): boolean {
  return Boolean(hole && (hole.scoreProvided === true || (hole.scoreProvided !== false && Number.isFinite(Number(hole.score)))))
}

function holeScore(hole?: HoleScoreDetail | null): number | null {
  if (!scoreProvided(hole)) return null
  const score = Number(hole?.score)
  return Number.isFinite(score) ? score : null
}

function holesByNumber(holes?: HoleScoreDetail[] | null) {
  const byHole = new Map<number, HoleScoreDetail>()
  ;(holes || []).forEach((hole, index) => {
    const holeNumber = Number(hole?.hole ?? index + 1)
    if (Number.isFinite(holeNumber) && holeNumber >= 1 && holeNumber <= 18) byHole.set(Math.trunc(holeNumber), hole)
  })
  return byHole
}

export function calculateTeamChallengePoints(
  proposerHoles?: HoleScoreDetail[] | null,
  challengedHoles?: HoleScoreDetail[] | null,
  scoringTypeValue: unknown = DEFAULT_TEAM_CHALLENGE_SCORING_TYPE,
  pointsPerHoleValue: unknown = DEFAULT_TEAM_CHALLENGE_POINTS_PER_HOLE,
): TeamChallengePointSummary {
  const scoringType = normalizeTeamChallengeScoringType(scoringTypeValue)
  const pointsPerHole = normalizeTeamChallengePointsPerHole(pointsPerHoleValue)
  const proposerByHole = holesByNumber(proposerHoles)
  const challengedByHole = holesByNumber(challengedHoles)
  let proposerPoints = 0
  let challengedPoints = 0
  let completedHoles = 0
  let carryoverPoints = pointsPerHole
  const holeResults: TeamChallengeHolePointResult[] = []

  for (let hole = 1; hole <= 18; hole += 1) {
    const proposerScore = holeScore(proposerByHole.get(hole))
    const challengedScore = holeScore(challengedByHole.get(hole))
    if (proposerScore === null || challengedScore === null) {
      holeResults.push({ hole, winner: 'pending', proposerScore, challengedScore, pointsAwarded: 0, carryoverAfterHole: scoringType === 'skins_push' ? carryoverPoints : 0 })
      continue
    }

    completedHoles += 1
    if (proposerScore === challengedScore) {
      if (scoringType === 'skins_push') carryoverPoints += pointsPerHole
      holeResults.push({ hole, winner: 'tie', proposerScore, challengedScore, pointsAwarded: 0, carryoverAfterHole: scoringType === 'skins_push' ? carryoverPoints : 0 })
      continue
    }

    const winner: Exclude<PointSide, 'tie' | 'pending'> = proposerScore < challengedScore ? 'proposer' : 'challenged'
    const awarded = scoringType === 'skins_push' ? carryoverPoints : pointsPerHole
    if (winner === 'proposer') proposerPoints += awarded
    if (winner === 'challenged') challengedPoints += awarded
    holeResults.push({ hole, winner, proposerScore, challengedScore, pointsAwarded: awarded, carryoverAfterHole: 0 })
    carryoverPoints = pointsPerHole
  }

  const proposerNetPoints = proposerPoints - challengedPoints
  const challengedNetPoints = challengedPoints - proposerPoints

  return {
    scoringType,
    pointsPerHole,
    proposerPoints,
    challengedPoints,
    proposerNetPoints,
    challengedNetPoints,
    completedHoles,
    carryoverPoints: scoringType === 'skins_push' && carryoverPoints > pointsPerHole ? carryoverPoints : 0,
    holeResults,
  }
}
