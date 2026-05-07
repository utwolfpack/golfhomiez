import type { ScoreEntry } from '../types'
import { compareRoundToHistory } from '../lib/roundInsights'
import { formatFriendlyDateTime } from '../lib/time-format'

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function RoundDetailModal({ round, allScores, onClose }: { round: ScoreEntry | null; allScores: ScoreEntry[]; onClose: () => void }) {
  if (!round) return null

  const holes = Array.isArray((round as any).holes)
    ? (round as any).holes.filter((value: unknown) => Number.isFinite(Number(value))).map((value: unknown) => Number(value))
    : []
  const insight = compareRoundToHistory(round as any, allScores as any)

  return (
    <div className="modalOverlay" role="presentation" onClick={onClose}>
      <div className="modalCard" role="dialog" aria-modal="true" aria-labelledby="round-detail-title" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h3 id="round-detail-title" style={{ margin: '4px 0 0' }}>{round.course}</h3>
            <div className="small" style={{ marginTop: 4 }}>
              {formatFriendlyDateTime(round.date)} • {String((round as any).state || '').toUpperCase()} • {round.mode === 'solo' ? 'Solo round' : 'Team round'}
            </div>
          </div>
          <button type="button" className="btn btnSmall" onClick={onClose}>Close</button>
        </div>

        <div className="detailGrid" style={{ marginTop: 14 }}>
          <div className="card detailPanel">
            <div className="small">Round Details</div>
            <div className="detailList" style={{ marginTop: 10 }}>
              {round.mode === 'solo' ? (
                <>
                  <div><strong>Score:</strong> {(round as any).roundScore}</div>
                  <div><strong>Logged by:</strong> {(round as any).createdByEmail || 'Unknown user'}</div>
                </>
              ) : (
                <>
                  <div><strong>Team:</strong> {(round as any).team}</div>
                  <div><strong>Opponent:</strong> {(round as any).opponentTeam}</div>
                  <div><strong>Score:</strong> {(round as any).teamTotal} - {(round as any).opponentTotal}</div>
                  <div><strong>Result:</strong> {(round as any).won === true ? 'Win' : (round as any).won === false ? 'Loss' : 'Tie'}</div>
                  <div><strong>Money:</strong> {formatMoney((round as any).money || 0)}</div>
                </>
              )}
              <div><strong>Logged at:</strong> {formatFriendlyDateTime((round as any).createdAt)}</div>
              <div><strong>Hole detail:</strong> {holes.length ? holes.join(', ') : 'No hole-by-hole detail saved'}</div>
            </div>
          </div>

          <div className="card detailPanel">
            <div className="small">How this round compares</div>
            <div style={{ marginTop: 10, lineHeight: 1.55 }}>{insight}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
