import type { HandicapStats } from '../lib/handicap'

function formatDifferential(value: number | null) {
  return value == null ? 'Not rated' : value.toFixed(1)
}

type Props = {
  open: boolean
  stats: HandicapStats
  onClose: () => void
}

export default function HandicapBreakdownModal({ open, stats, onClose }: Props) {
  if (!open) return null

  return (
    <div className="modalOverlay" role="presentation" onClick={onClose}>
      <div className="modalCard handicapModalCard" role="dialog" aria-modal="true" aria-labelledby="handicap-breakdown-title" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div className="small">Handicap breakdown</div>
            <h3 id="handicap-breakdown-title" style={{ margin: '4px 0 0' }}>How your handicap was calculated</h3>
            <div className="small" style={{ marginTop: 4 }}>{stats.formulaText}</div>
          </div>
          <button type="button" className="btn btnSmall" onClick={onClose}>Close</button>
        </div>

        <div className="detailGrid" style={{ marginTop: 14 }}>
          <div className="card detailPanel">
            <div className="small">Current filtered handicap</div>
            <div className="handicapHeadline">{stats.handicap != null ? stats.handicap.toFixed(1) : '—'}</div>
            <div className="detailList" style={{ marginTop: 10 }}>
              <div><strong>Rated rounds considered:</strong> {stats.ratedRounds}</div>
              <div><strong>Differentials used:</strong> {stats.differentialsUsed}</div>
              <div><strong>Total solo rounds in filters:</strong> {stats.soloRounds}</div>
            </div>
          </div>

          <div className="card detailPanel">
            <div className="small">Formula</div>
            <div style={{ marginTop: 10, lineHeight: 1.55 }}>
              Differential = ((Score − Course Rating) × 113) ÷ Slope Rating.
              <br />
              Handicap index = average of the lowest eligible differential(s) from your filtered rated solo rounds.
            </div>
          </div>
        </div>

        <div className="card detailPanel" style={{ marginTop: 12 }}>
          <div className="small">Logged events used in the formula</div>
          <div className="handicapRoundsTable" style={{ marginTop: 10 }}>
            {stats.consideredRounds.length ? stats.consideredRounds.map((round) => (
              <div key={round.id} className="handicapRoundRow">
                <div>
                  <div className="roundRowTitle">{round.course}</div>
                  <div className="roundRowMeta">{round.date} • {round.state || '—'} • Score {Number.isFinite(round.roundScore) ? round.roundScore : '—'}</div>
                </div>
                <div className="handicapRoundMeta">
                  <div className="small">CR {round.courseRating != null ? round.courseRating.toFixed(1) : '—'} • Slope {round.slopeRating != null ? round.slopeRating : '—'}</div>
                  <div><strong>Differential:</strong> {formatDifferential(round.differential)}</div>
                  <div className={`pill ${round.included ? '' : 'pillMuted'}`}>{round.included ? 'Included' : 'Considered only'}</div>
                </div>
              </div>
            )) : <div className="small">No solo rounds are available for the current filters.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
