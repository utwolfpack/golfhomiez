import type { HoleScoreDetail } from '../types'
import { normalizeTeamChallengePointsPerHole, normalizeTeamChallengeScoringType, type TeamChallengeScoringType } from './team-challenge-scoring'

export type IndividualChallengeScoringParticipant = {
  key: string
  name: string
  holes?: HoleScoreDetail[] | null
}

export type IndividualChallengeHoleResult = {
  hole: number
  par: number | null
  status: 'pending' | 'push' | 'won'
  winnerKey: string | null
  winnerName: string | null
  winnerScore: number | null
  worstScore: number | null
  worstParticipantNames: string[]
  recordedScoreCount: number
  pointsAwarded: number
  carryoverAfterHole: number
  strokeDifferential: number
}

export type IndividualChallengeScoringSummary = {
  scoringType: TeamChallengeScoringType
  pointsPerHole: number
  participantPoints: Record<string, number>
  resolvedHoles: number
  pushedHoles: number
  carryoverPoints: number
  holeResults: IndividualChallengeHoleResult[]
}

function scoreProvided(hole?: HoleScoreDetail | null): boolean {
  return Boolean(hole && (hole.scoreProvided === true || (hole.scoreProvided !== false && hole.score !== null && hole.score !== undefined && Number.isFinite(Number(hole.score)))))
}

function scoreValue(hole?: HoleScoreDetail | null): number | null {
  if (!scoreProvided(hole)) return null
  const score = Number(hole?.score)
  return Number.isFinite(score) ? score : null
}

function holeNumber(hole: HoleScoreDetail | undefined, index: number) {
  const value = Number(hole?.hole ?? index + 1)
  return Number.isFinite(value) && value >= 1 && value <= 18 ? Math.trunc(value) : null
}

function holesByNumber(holes?: HoleScoreDetail[] | null) {
  const byHole = new Map<number, HoleScoreDetail>()
  ;(holes || []).forEach((hole, index) => {
    const number = holeNumber(hole, index)
    if (number != null) byHole.set(number, hole)
  })
  return byHole
}

function resolveHoleCount(participants: IndividualChallengeScoringParticipant[]) {
  const explicitHoleCounts = participants
    .map((participant) => participant.holes?.length || 0)
    .filter((count) => count > 0)
  return explicitHoleCounts.length > 0 && explicitHoleCounts.every((count) => count <= 9) && explicitHoleCounts.some((count) => count === 9) ? 9 : 18
}

export function calculateIndividualChallengePoints(
  participants: IndividualChallengeScoringParticipant[],
  scoringTypeValue: unknown = 'stroke_play',
  pointsPerHoleValue: unknown = 1,
): IndividualChallengeScoringSummary {
  const scoringType = normalizeTeamChallengeScoringType(scoringTypeValue)
  const pointsPerHole = normalizeTeamChallengePointsPerHole(pointsPerHoleValue)
  const participantPoints = Object.fromEntries(participants.map((participant) => [participant.key, 0]))
  const holeMaps = participants.map((participant) => ({ participant, holes: holesByNumber(participant.holes) }))
  const holeCount = resolveHoleCount(participants)
  const holeResults: IndividualChallengeHoleResult[] = []
  let carryoverPoints = 0
  let resolvedHoles = 0
  let pushedHoles = 0

  for (let hole = 1; hole <= holeCount; hole += 1) {
    const scores = holeMaps
      .map(({ participant, holes }) => ({ participant, hole: holes.get(hole), score: scoreValue(holes.get(hole)) }))
      .filter((entry): entry is { participant: IndividualChallengeScoringParticipant; hole: HoleScoreDetail | undefined; score: number } => entry.score !== null)
    const par = scores.map((entry) => Number(entry.hole?.par)).find((value) => Number.isFinite(value) && value > 0) ?? null

    if (scores.length < 2) {
      holeResults.push({
        hole,
        par,
        status: 'pending',
        winnerKey: null,
        winnerName: null,
        winnerScore: null,
        worstScore: scores.length ? scores[0].score : null,
        worstParticipantNames: scores.length ? [scores[0].participant.name] : [],
        recordedScoreCount: scores.length,
        pointsAwarded: 0,
        carryoverAfterHole: 0,
        strokeDifferential: 0,
      })
      continue
    }

    resolvedHoles += 1
    const winnerScore = Math.min(...scores.map((entry) => entry.score))
    const worstScore = Math.max(...scores.map((entry) => entry.score))
    const lowest = scores.filter((entry) => entry.score === winnerScore)
    const worstParticipantNames = scores.filter((entry) => entry.score === worstScore).map((entry) => entry.participant.name)

    if (lowest.length !== 1) {
      pushedHoles += 1
      if (scoringType === 'skins_push') carryoverPoints += pointsPerHole
      holeResults.push({
        hole,
        par,
        status: 'push',
        winnerKey: null,
        winnerName: null,
        winnerScore,
        worstScore,
        worstParticipantNames,
        recordedScoreCount: scores.length,
        pointsAwarded: 0,
        carryoverAfterHole: scoringType === 'skins_push' ? carryoverPoints : 0,
        strokeDifferential: 0,
      })
      continue
    }

    const winner = lowest[0]
    const strokeDifferential = Math.max(1, worstScore - winnerScore)
    const baseAward = scoringType === 'skins_push' ? strokeDifferential * pointsPerHole : pointsPerHole
    const awarded = scoringType === 'skins_push' ? baseAward + carryoverPoints : scoringType === 'skins' ? baseAward : 0
    if (awarded > 0) participantPoints[winner.participant.key] = (participantPoints[winner.participant.key] || 0) + awarded
    holeResults.push({
      hole,
      par,
      status: 'won',
      winnerKey: winner.participant.key,
      winnerName: winner.participant.name,
      winnerScore,
      worstScore,
      worstParticipantNames,
      recordedScoreCount: scores.length,
      pointsAwarded: awarded,
      carryoverAfterHole: 0,
      strokeDifferential,
    })
    if (scoringType === 'skins_push') carryoverPoints = 0
  }

  return {
    scoringType,
    pointsPerHole,
    participantPoints,
    resolvedHoles,
    pushedHoles,
    carryoverPoints: scoringType === 'skins_push' ? carryoverPoints : 0,
    holeResults,
  }
}
