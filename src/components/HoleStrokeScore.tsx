import type { ReactNode } from 'react'

type HoleStrokeOutcome = 'albatross' | 'eagle' | 'birdie' | 'par' | 'bogey' | 'double-bogey' | 'max' | 'unknown'

type Props = {
  score?: number | null
  par?: number | null
  className?: string
  compact?: boolean
  emptyValue?: ReactNode
}

export function holeStrokeOutcome(score?: number | null, par?: number | null): HoleStrokeOutcome {
  const normalizedScore = Number(score)
  const normalizedPar = Number(par)
  if (!Number.isFinite(normalizedScore) || score == null || !Number.isFinite(normalizedPar) || par == null) return 'unknown'
  const relative = normalizedScore - normalizedPar
  if (relative <= -3) return 'albatross'
  if (relative === -2) return 'eagle'
  if (relative === -1) return 'birdie'
  if (relative === 0) return 'par'
  if (relative === 1) return 'bogey'
  if (relative === 2) return 'double-bogey'
  return 'max'
}

export function holeStrokeOutcomeLabel(outcome: HoleStrokeOutcome) {
  if (outcome === 'double-bogey') return 'Double bogey'
  if (outcome === 'max') return 'Triple bogey or higher'
  if (outcome === 'unknown') return 'Score'
  return outcome.charAt(0).toUpperCase() + outcome.slice(1)
}

function DecorativeShape({ outcome }: { outcome: HoleStrokeOutcome }) {
  if (outcome === 'albatross') {
    return (
      <svg className="holeStrokeScoreShape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 21.2 3.6 13C-.1 9.4 1.8 3.5 6.8 3.1 9 2.9 10.8 4 12 5.6 13.2 4 15 2.9 17.2 3.1c5 .4 6.9 6.3 3.2 9.9L12 21.2Z" />
      </svg>
    )
  }

  if (outcome === 'max') {
    return (
      <svg className="holeStrokeScoreShape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <polygon points="12.00,2.00 13.42,4.84 15.83,2.76 16.06,5.93 19.07,4.93 18.07,7.94 21.24,8.17 19.16,10.58 22.00,12.00 19.16,13.42 21.24,15.83 18.07,16.06 19.07,19.07 16.06,18.07 15.83,21.24 13.42,19.16 12.00,22.00 10.58,19.16 8.17,21.24 7.94,18.07 4.93,19.07 5.93,16.06 2.76,15.83 4.84,13.42 2.00,12.00 4.84,10.58 2.76,8.17 5.93,7.94 4.93,4.93 7.94,5.93 8.17,2.76 10.58,4.84" />
      </svg>
    )
  }

  return null
}

export default function HoleStrokeScore({ score, par, className = '', compact = false, emptyValue = '—' }: Props) {
  const normalizedScore = Number(score)
  if (score == null || !Number.isFinite(normalizedScore)) return <span className={className}>{emptyValue}</span>

  const outcome = holeStrokeOutcome(score, par)
  const label = holeStrokeOutcomeLabel(outcome)
  const classes = [
    'holeStrokeScore',
    `holeStrokeScore--${outcome}`,
    compact ? 'holeStrokeScore--compact' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <span className={classes} title={`${normalizedScore} — ${label}`} aria-label={`${normalizedScore} ${normalizedScore === 1 ? 'stroke' : 'strokes'}, ${label}`}>
      <DecorativeShape outcome={outcome} />
      <span className="holeStrokeScoreValue">{normalizedScore}</span>
    </span>
  )
}
