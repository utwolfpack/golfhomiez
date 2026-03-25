import type { HandicapStats } from '../lib/handicap'

type Props = {
  stats: HandicapStats
  onClick: () => void
}

export default function HandicapSummaryCard({ stats, onClick }: Props) {
  const subtitle = stats.roundsUsed
    ? `${stats.roundsUsed} rated round${stats.roundsUsed === 1 ? '' : 's'} in current filters`
    : 'Need rated solo rounds in current filters'

  return (
    <button
      type="button"
      className="card statCardCompact handicapSummaryCard"
      onClick={onClick}
      aria-label="Open handicap breakdown"
    >
      <div className="small statCardLabel">Handicap</div>
      <div className="statCardValue">{stats.handicap != null ? stats.handicap.toFixed(1) : '—'}</div>
      <div className="small statCardSubtitle">{subtitle}</div>
      <div className="small handicapSummaryHint">Tap to view formula and logged rounds used</div>
    </button>
  )
}
