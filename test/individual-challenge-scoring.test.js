import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadIndividualScoringModule() {
  const teamSource = await readFile(new URL('../src/lib/team-challenge-scoring.ts', import.meta.url), 'utf8')
  const teamCompiled = ts.transpileModule(teamSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const teamUrl = `data:text/javascript;base64,${globalThis.Buffer.from(teamCompiled).toString('base64')}`

  const individualSource = await readFile(new URL('../src/lib/individual-challenge-scoring.ts', import.meta.url), 'utf8')
  const individualCompiled = ts.transpileModule(individualSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace("from './team-challenge-scoring'", `from '${teamUrl}'`)
  const individualUrl = `data:text/javascript;base64,${globalThis.Buffer.from(individualCompiled).toString('base64')}`
  return import(individualUrl)
}

function participant(key, name, scores, par = 4) {
  return {
    key,
    name,
    holes: scores.map((score, index) => ({ hole: index + 1, par, score, scoreProvided: score != null })),
  }
}

test('individual skins awards only an outright low score and does not carry ties', async () => {
  const { calculateIndividualChallengePoints } = await loadIndividualScoringModule()
  const result = calculateIndividualChallengePoints([
    participant('a', 'A', [3, 4]),
    participant('b', 'B', [4, 4]),
    participant('c', 'C', [5, 6]),
  ], 'skins', 2)

  assert.equal(result.holeResults[0].status, 'won')
  assert.equal(result.holeResults[0].winnerName, 'A')
  assert.equal(result.holeResults[0].pointsAwarded, 2)
  assert.equal(result.holeResults[1].status, 'push')
  assert.equal(result.holeResults[1].pointsAwarded, 0)
  assert.equal(result.carryoverPoints, 0)
  assert.equal(result.participantPoints.a, 2)
})

test('individual skins push pays the winner for stroke gap to the worst score plus all pushed-hole carryover', async () => {
  const { calculateIndividualChallengePoints } = await loadIndividualScoringModule()
  const result = calculateIndividualChallengePoints([
    participant('a', 'Alex', [4, 5, 3]),
    participant('b', 'Blake', [4, 5, 5]),
    participant('c', 'Casey', [6, 5, 6]),
  ], 'skins_push', 1)

  assert.equal(result.holeResults[0].status, 'push')
  assert.equal(result.holeResults[0].carryoverAfterHole, 1)
  assert.equal(result.holeResults[1].status, 'push')
  assert.equal(result.holeResults[1].carryoverAfterHole, 2)
  assert.equal(result.holeResults[2].status, 'won')
  assert.equal(result.holeResults[2].winnerName, 'Alex')
  assert.equal(result.holeResults[2].winnerScore, 3)
  assert.equal(result.holeResults[2].worstScore, 6)
  assert.deepEqual(result.holeResults[2].worstParticipantNames, ['Casey'])
  assert.equal(result.holeResults[2].strokeDifferential, 3)
  assert.equal(result.holeResults[2].pointsAwarded, 5)
  assert.equal(result.participantPoints.a, 5)
  assert.equal(result.carryoverPoints, 0)
})


test('individual skins records every golfer tied for the worst score on a hole', async () => {
  const { calculateIndividualChallengePoints } = await loadIndividualScoringModule()
  const result = calculateIndividualChallengePoints([
    participant('a', 'Alex', [3]),
    participant('b', 'Blake', [5]),
    participant('c', 'Casey', [5]),
  ], 'skins_push', 1)

  assert.equal(result.holeResults[0].winnerName, 'Alex')
  assert.equal(result.holeResults[0].worstScore, 5)
  assert.deepEqual(result.holeResults[0].worstParticipantNames, ['Blake', 'Casey'])
})

test('individual skins push keeps a hole pending until at least two golfers have recorded that hole', async () => {
  const { calculateIndividualChallengePoints } = await loadIndividualScoringModule()
  const result = calculateIndividualChallengePoints([
    participant('a', 'A', [3]),
    participant('b', 'B', [null]),
  ], 'skins_push', 1)

  assert.equal(result.holeResults[0].status, 'pending')
  assert.equal(result.holeResults[0].recordedScoreCount, 1)
  assert.equal(result.holeResults[0].pointsAwarded, 0)
  assert.equal(result.carryoverPoints, 0)
})
