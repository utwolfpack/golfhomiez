import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

function requireSource(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

async function loadScoringModule() {
  const source = await readFile(new URL('../src/lib/team-challenge-scoring.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  return import(url)
}

function holes(scores, par = null) {
  return scores.map((score, index) => ({ hole: index + 1, par, score, scoreProvided: true }))
}

test('skins-push only creates rollover points after a tied hole', async () => {
  const { calculateTeamChallengePoints } = await loadScoringModule()

  const noTie = calculateTeamChallengePoints(holes([4]), holes([5]), 'skins_push', 1)
  assert.equal(noTie.holeResults[0].pointsAwarded, 1)
  assert.equal(noTie.holeResults[0].carryoverAfterHole, 0)
  assert.equal(noTie.carryoverPoints, 0)

  const tieThenWin = calculateTeamChallengePoints(holes([4, 4]), holes([4, 5]), 'skins_push', 1)
  assert.equal(tieThenWin.holeResults[0].winner, 'tie')
  assert.equal(tieThenWin.holeResults[0].carryoverAfterHole, 1)
  assert.equal(tieThenWin.holeResults[1].pointsAwarded, 2)
  assert.equal(tieThenWin.holeResults[1].carryoverAfterHole, 0)

  const twoPushesThenWin = calculateTeamChallengePoints(holes([4, 4, 4]), holes([4, 4, 5]), 'skins_push', 1)
  assert.equal(twoPushesThenWin.holeResults[0].carryoverAfterHole, 1)
  assert.equal(twoPushesThenWin.holeResults[1].carryoverAfterHole, 2)
  assert.equal(twoPushesThenWin.holeResults[2].pointsAwarded, 3)
  assert.equal(twoPushesThenWin.carryoverPoints, 0)
})

test('skins-push follows the requested one-point examples for stroke differential', async () => {
  const { calculateTeamChallengePoints } = await loadScoringModule()

  const parToBogey = calculateTeamChallengePoints(holes([4], 4), holes([5], 4), 'skins_push', 1)
  const parToDouble = calculateTeamChallengePoints(holes([4], 4), holes([6], 4), 'skins_push', 1)
  const birdieToBogey = calculateTeamChallengePoints(holes([3], 4), holes([5], 4), 'skins_push', 1)
  const parToTriple = calculateTeamChallengePoints(holes([4], 4), holes([7], 4), 'skins_push', 1)

  assert.equal(parToBogey.holeResults[0].pointsAwarded, 1)
  assert.equal(parToDouble.holeResults[0].pointsAwarded, 2)
  assert.equal(birdieToBogey.holeResults[0].pointsAwarded, 3)
  assert.equal(parToTriple.holeResults[0].pointsAwarded, 3)
})


test('skins-push round detail displays the actual tied-hole carryover instead of subtracting a phantom base point', () => {
  const roundDetail = requireSource('../src/components/RoundDetailModal.tsx')
  assert.match(roundDetail, /result\.winner === 'tie' \|\| result\.winner === 'pending'\) return Math\.max\(0, result\.carryoverAfterHole\)/)
  assert.doesNotMatch(roundDetail, /carryoverAfterHole - pointSummary\.pointsPerHole/)
})

test('team challenge scoring only produces nine leaderboard holes when both course scorecards contain nine holes', async () => {
  const { calculateTeamChallengePoints } = await loadScoringModule()
  const nineHoleScores = holes([4, 4, 3, 5, 4, 4, 3, 5, 4], 4)
  const result = calculateTeamChallengePoints(nineHoleScores, nineHoleScores, 'skins_push', 1)
  assert.equal(result.holeResults.length, 9)
  assert.equal(result.holeResults.at(-1)?.hole, 9)
})
