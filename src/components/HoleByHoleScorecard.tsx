import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import {
  buildClientDefaultHoleScorecard,
  formatHoleScoreOutcome,
  holeParTotal,
  holeScoreTotal,
  mergeProvidedHoleScores,
  missingHoleScoreNumbers,
  normalizeHoleScorecard,
  updateHoleScore,
} from '../lib/hole-scorecard'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import type { HoleScoreDetail } from '../types'

type ScorecardResponse = {
  source: string
  state: string
  course: string
  courseId?: string | null
  holes: HoleScoreDetail[]
  parTotal: number
  scoreTotal: number
}

type ScorecardDraftResponse = {
  holes: HoleScoreDetail[]
  holeCount: number
}

type DraftContext = {
  mode: 'solo' | 'team'
  date: string
  team?: string
  opponentTeam?: string
  scoringSide?: 'team' | 'opponent'
}

type Props = {
  enabled: boolean
  stateCode: string
  course: string
  holes: HoleScoreDetail[]
  onChange: (holes: HoleScoreDetail[]) => void
  onHoleSaved?: (holes: HoleScoreDetail[], savedHole: HoleScoreDetail) => void | Promise<unknown>
  draftContext?: DraftContext
  scoreOwnerLabel?: string
  loadScorecardOnMount?: boolean
  compactMobileInput?: boolean
}

type ScorePreset = {
  key: string
  label: string
  className: string
  getScore: (par: number) => number
}

const SCORE_PRESETS: ScorePreset[] = [
  { key: 'birdie', label: 'Birdie', className: 'holeInputPreset--birdie', getScore: (par) => Math.max(1, par - 1) },
  { key: 'par', label: 'Par', className: 'holeInputPreset--par', getScore: (par) => par },
  { key: 'bogey', label: 'Bogey', className: 'holeInputPreset--bogey', getScore: (par) => par + 1 },
  { key: 'double-bogey', label: 'Double-Bogey', className: 'holeInputPreset--doubleBogey', getScore: (par) => par + 2 },
]

function getSafeHole(holes: HoleScoreDetail[], index: number, stateCode: string, course: string) {
  return holes[index] || holes[0] || buildClientDefaultHoleScorecard(stateCode, course)[0]
}

function buildDraftSearchParams(stateCode: string, course: string, draftContext?: DraftContext) {
  if (!draftContext?.mode || !draftContext.date || !stateCode || !course) return null
  const params = new URLSearchParams({
    mode: draftContext.mode,
    date: draftContext.date,
    state: stateCode,
    course,
    scoringSide: draftContext.scoringSide || 'team',
  })
  if (draftContext.team) params.set('team', draftContext.team)
  if (draftContext.opponentTeam) params.set('opponentTeam', draftContext.opponentTeam)
  return params
}

function getScoreOrPar(hole: HoleScoreDetail) {
  return Number.isFinite(hole.score) ? hole.score : hole.par
}

function getNextRequiredHoleIndex(holes: HoleScoreDetail[], currentHoleNumber: number) {
  const remaining = missingHoleScoreNumbers(holes)
  if (!remaining.length) return null
  const nextAfterCurrent = remaining.find((holeNumber) => holeNumber > currentHoleNumber)
  const targetHoleNumber = nextAfterCurrent ?? remaining[0]
  const targetIndex = holes.findIndex((hole) => hole.hole === targetHoleNumber)
  return targetIndex >= 0 ? targetIndex : Math.max(0, Math.min(holes.length - 1, targetHoleNumber - 1))
}

export default function HoleByHoleScorecard({ enabled, stateCode, course, holes, onChange, onHoleSaved, draftContext, scoreOwnerLabel, loadScorecardOnMount = true, compactMobileInput = false }: Props) {
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeHoleIndex, setActiveHoleIndex] = useState(0)
  const [activeScore, setActiveScore] = useState(4)
  const [savingHole, setSavingHole] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const parTotal = useMemo(() => holeParTotal(holes), [holes])
  const scoreTotal = useMemo(() => holeScoreTotal(holes), [holes])
  const missingNumbers = useMemo(() => missingHoleScoreNumbers(holes), [holes])
  const activeHole = getSafeHole(holes, activeHoleIndex, stateCode, course)
  const activeHoleCount = holes.length || 18
  const providedCount = Math.max(0, activeHoleCount - missingNumbers.length)
  const draftParams = useMemo(
    () => buildDraftSearchParams(stateCode, course, draftContext),
    [stateCode, course, draftContext?.mode, draftContext?.date, draftContext?.team, draftContext?.opponentTeam, draftContext?.scoringSide],
  )

  useEffect(() => {
    if (!enabled || !loadScorecardOnMount) return

    let cancelled = false
    const correlationId = getCorrelationId()

    async function loadScorecard() {
      setLoading(true)
      setLoadError(null)
      setSaveStatus(null)
      logFrontendEvent({ category: 'scorecard.load', message: 'started', data: { correlationId, stateCode, course, draftContext } })

      try {
        let nextHoles: HoleScoreDetail[]
        let source = 'generated-defaults'
        let responseParTotal = 0

        if (!stateCode || !course) {
          nextHoles = buildClientDefaultHoleScorecard(stateCode, course)
          responseParTotal = holeParTotal(nextHoles)
        } else {
          const response = await api<ScorecardResponse>(`/api/golf-courses/scorecard?state=${encodeURIComponent(stateCode)}&course=${encodeURIComponent(course)}`)
          if (cancelled) return
          nextHoles = normalizeHoleScorecard(response.holes, stateCode, course)
          source = response.source
          responseParTotal = response.parTotal
        }

        if (draftParams) {
          try {
            const draft = await api<ScorecardDraftResponse>(`/api/scorecard-drafts?${draftParams.toString()}`)
            if (cancelled) return
            nextHoles = mergeProvidedHoleScores(nextHoles, draft.holes)
            if (draft.holeCount > 0) {
              setSaveStatus(`Restored ${draft.holeCount} saved hole ${draft.holeCount === 1 ? 'score' : 'scores'}.`)
            }
          } catch (draftError) {
            const message = draftError instanceof Error ? draftError.message : 'Could not restore saved hole scores.'
            logFrontendEvent({ category: 'scorecard.draft.load', level: 'warn', message: 'failed', data: { correlationId, stateCode, course, error: message } })
          }
        }

        onChange(nextHoles)
        setActiveHoleIndex(0)
        logFrontendEvent({
          category: 'scorecard.load',
          message: 'succeeded',
          data: { correlationId, stateCode, course, source, parTotal: responseParTotal, holeCount: nextHoles.length, providedCount: nextHoles.length - missingHoleScoreNumbers(nextHoles).length },
        })
      } catch (error) {
        if (cancelled) return
        const fallback = buildClientDefaultHoleScorecard(stateCode, course)
        onChange(fallback)
        setActiveHoleIndex(0)
        const message = error instanceof Error ? error.message : 'Scorecard defaults were used.'
        setLoadError(message)
        logFrontendEvent({ category: 'scorecard.load', level: 'warn', message: 'fallback_used', data: { correlationId, stateCode, course, error: message } })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadScorecard()
    return () => { cancelled = true }
  }, [enabled, loadScorecardOnMount, stateCode, course, draftParams?.toString()])

  useEffect(() => {
    if (activeHoleIndex >= holes.length && holes.length > 0) setActiveHoleIndex(holes.length - 1)
  }, [activeHoleIndex, holes.length])

  useEffect(() => {
    setActiveScore(getScoreOrPar(activeHole))
  }, [activeHole.hole, activeHole.par, activeHole.score])

  async function saveHoleScore(hole: HoleScoreDetail, score: number, source: string) {
    const normalizedScore = Math.max(0, Math.trunc(score))
    const next = updateHoleScore(holes, hole.hole, normalizedScore)
    const correlationId = getCorrelationId()

    onChange(next)
    setSavingHole(true)
    setSaveStatus('Saving hole score…')
    logFrontendEvent({
      category: 'scorecard.hole.save',
      message: 'started',
      data: { correlationId, hole: hole.hole, score: normalizedScore, source, cumulativeScore: holeScoreTotal(next), draftContext },
    })

    try {
      const savedHole = {
        ...hole,
        score: normalizedScore,
        scoreProvided: true,
      }
      if (draftParams) {
        await api('/api/scorecard-drafts/hole', {
          method: 'PUT',
          body: JSON.stringify({
            mode: draftContext?.mode,
            date: draftContext?.date,
            state: stateCode,
            course,
            team: draftContext?.team || '',
            opponentTeam: draftContext?.opponentTeam || '',
            scoringSide: draftContext?.scoringSide || 'team',
            hole: savedHole,
          }),
        })
      }
      if (onHoleSaved) {
        await onHoleSaved(next, savedHole)
      }
      const nextRequiredHoleIndex = getNextRequiredHoleIndex(next, hole.hole)
      const nextRequiredHole = nextRequiredHoleIndex == null ? null : next[nextRequiredHoleIndex]?.hole
      if (nextRequiredHoleIndex == null) {
        setSaveStatus(`Hole ${hole.hole} saved. Complete round ready to log.`)
      } else {
        setActiveHoleIndex(nextRequiredHoleIndex)
        setSaveStatus(`Hole ${hole.hole} saved. Next required hole: ${nextRequiredHole}.`)
      }
      logFrontendEvent({
        category: 'scorecard.hole.save',
        message: 'succeeded',
        data: { correlationId, hole: hole.hole, score: normalizedScore, remainingHoleCount: missingHoleScoreNumbers(next).length, nextRequiredHole },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save this hole score.'
      setSaveStatus('Saved on this page, but database persistence failed. Try saving again before leaving.')
      logFrontendEvent({ category: 'scorecard.hole.save', level: 'error', message: 'failed', data: { correlationId, hole: hole.hole, score: normalizedScore, error: message } })
    } finally {
      setSavingHole(false)
    }
  }

  function goToHole(index: number) {
    setSaveStatus(null)
    setActiveHoleIndex(Math.max(0, Math.min(activeHoleCount - 1, index)))
  }

  if (!enabled) return null

  const currentOutcome = formatHoleScoreOutcome({ par: activeHole.par, score: activeScore })
  const currentHoleProvided = Boolean(activeHole.scoreProvided)

  return (
    <div className={`card holeInputPanel ${compactMobileInput ? 'holeInputPanel--compact' : ''}`} style={{ marginTop: 16 }}>
      {loadError ? <div className="small holeInputLoadWarning">Using generated defaults until course hole data is available.</div> : null}

      <section className={`holeInputPhone ${compactMobileInput ? 'holeInputPhone--compact' : ''}`} aria-label={`Score entry for hole ${activeHole.hole}`}>
        <div className={`holeInputScorePageCard ${compactMobileInput ? 'holeInputScorePageCard--compact' : ''}`}>
          {scoreOwnerLabel ? <div className="holeInputTeamLabel">{scoreOwnerLabel}</div> : null}
          <div className="holeInputScoreLabel">Score for Hole {activeHole.hole}</div>
          <div className="scoreStepper holeInputPageStepper">
            <button type="button" className="btn holeInputStepperButton" aria-label="Decrease score" onClick={() => setActiveScore((score) => Math.max(0, score - 1))}>−</button>
            <div className="holeInputScoreValueBlock">
              <div className="scoreStepperValue" aria-live="polite">{activeScore}</div>
              <div className="holeInputOutcome" aria-live="polite">{currentOutcome}</div>
            </div>
            <button type="button" className="btn holeInputStepperButton" aria-label="Increase score" onClick={() => setActiveScore((score) => score + 1)}>+</button>
          </div>

          <div className="holeInputPresetGrid" aria-label="Quick score presets">
            {SCORE_PRESETS.map((preset) => {
              const presetScore = preset.getScore(activeHole.par)
              return (
                <button
                  key={preset.key}
                  type="button"
                  className={`holeInputPreset ${preset.className}${activeScore === presetScore ? ' holeInputPreset--selected' : ''}`}
                  onClick={() => setActiveScore(presetScore)}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            className="btnPrimary holeInputSaveButton"
            disabled={savingHole}
            onClick={() => saveHoleScore(activeHole, activeScore, 'dedicated_hole_page')}
          >
            {savingHole ? 'Saving…' : currentHoleProvided ? 'Update Hole Score' : 'Save Hole Score'}
          </button>
          {saveStatus ? <div className="small holeInputSaveStatus">{saveStatus}</div> : null}
        </div>

        <footer className="holeInputFooter">
          <div className="holeInputMetadata" aria-label="Hole details">
            <span className="holeInputPin" aria-hidden="true">⚲</span>
            <span>Par {activeHole.par}</span>
            <span aria-hidden="true">|</span>
            <span>{activeHole.yards || '—'} Yards</span>
            <span aria-hidden="true">|</span>
            <span>Stroke Index {activeHole.strokeIndex || activeHole.hole}</span>
          </div>
          <div className="holeInputNavigation">
            <button
              type="button"
              className="btn holeInputNavButton"
              onClick={() => goToHole(activeHoleIndex - 1)}
              disabled={activeHoleIndex <= 0}
            >
              <span aria-hidden="true">←</span> Previous Hole
            </button>
            <button
              type="button"
              className="btnPrimary holeInputNavButton"
              onClick={() => goToHole(activeHoleIndex + 1)}
              disabled={activeHoleIndex >= activeHoleCount - 1}
            >
              Next Hole <span aria-hidden="true">→</span>
            </button>
          </div>
        </footer>
      </section>

      <div className="holeInputCompletionIndicator" aria-live="polite">
        <span className="holeInputCompletionSummary">{providedCount} of {activeHoleCount} holes provided</span>
        {missingNumbers.length ? (
          <>
            <span className="small">Still needed:</span>
            <div className="holeInputMissingList">
              {missingNumbers.map((holeNumber) => (
                <button key={holeNumber} type="button" className="holeInputMissingChip" onClick={() => goToHole(holeNumber - 1)}>
                  {holeNumber}
                </button>
              ))}
            </div>
          </>
        ) : (
          <strong className="holeInputCompleteBadge">Complete round ready to log</strong>
        )}
      </div>

      <div className="holeInputPageTotals" aria-label="Round totals">
        <div>
          <span>Course par</span>
          <strong>{loading ? '…' : parTotal}</strong>
        </div>
        <div>
          <span>Cumulative score</span>
          <strong>{loading ? '…' : scoreTotal}</strong>
        </div>
      </div>
    </div>
  )
}
