import type { HandicapStats } from '../lib/handicap'

type TeamStats = {
  total: number
  wins: number
  losses: number
  ties: number
  winPct: number
}

type SoloStats = {
  total: number
  avg: number
  best: number
}

type Props = {
  view: 'all' | 'team' | 'solo'
  roundCount: number
  teamStats: TeamStats
  soloStats: SoloStats
  handicapStats: HandicapStats
  onHandicapClick: () => void
}

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

export default function FilteredGolfProfileSummary({
  view,
  roundCount,
  teamStats,
  soloStats,
  handicapStats,
  onHandicapClick,
}: Props) {
  const teamRecord = `${teamStats.wins}-${teamStats.losses}${teamStats.ties ? `-${teamStats.ties}` : ''}`
  const hasHandicap = handicapStats.handicap != null

  return (
    <section className="filteredGolfProfileSummary" aria-live="polite" aria-label="Filtered golf profile summary">
      <div className="filteredGolfProfileSummaryLabel">Filtered profile</div>
      <p className="filteredGolfProfileSummaryText">
        <strong>{pluralize(roundCount, 'round')}</strong> match the current filters.
        {view !== 'solo' && teamStats.total > 0 ? (
          <>
            {' '}Team challenges: <strong>{pluralize(teamStats.total, 'round')}</strong>, with a <strong>{teamRecord}</strong> record and <strong>{teamStats.winPct.toFixed(0)}%</strong> win rate.
          </>
        ) : null}
        {view !== 'team' && soloStats.total > 0 ? (
          <>
            {' '}Solo rounds: <strong>{pluralize(soloStats.total, 'round')}</strong>, averaging <strong>{soloStats.avg.toFixed(1)}</strong> with a best score of <strong>{soloStats.best}</strong>.
          </>
        ) : null}
        {view !== 'team' ? (
          hasHandicap ? (
            <>
              {' '}Handicap:{' '}
              <button
                type="button"
                className="filteredGolfProfileHandicapLink"
                onClick={onHandicapClick}
                aria-label={`View handicap information for handicap ${handicapStats.handicap?.toFixed(1)}`}
              >
                {handicapStats.handicap?.toFixed(1)}
              </button>
              .
            </>
          ) : (
            <> Handicap is not available for the current filters.</>
          )
        ) : null}
      </p>
    </section>
  )
}
