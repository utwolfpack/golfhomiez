import PageHero from '../components/PageHero'

export default function Directions() {
  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="How to play"
          title="Directions to Scramble"
          subtitle="Keep the format simple, move quickly, and let Golf Homiez handle the tracking afterward."
        />

        <div className="grid grid2" style={{ marginTop: 12 }}>
          <div className="card" style={{ background: 'rgba(255,255,255,.7)' }}>
            <ol style={{ lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
              <li><strong>Form teams</strong> (2–4 players per team). Decide team names.</li>
              <li><strong>Tee off</strong> and each player hits a shot.</li>
              <li><strong>Choose the best ball</strong> among the team’s shots.</li>
              <li><strong>All players play from that spot</strong> within one club length, no closer to the hole.</li>
              <li>Repeat until the ball is holed and record the <strong>team score</strong> for the hole.</li>
              <li>After 18 holes, compare totals. Lower total wins.</li>
            </ol>
          </div>
          <div className="card" style={{ background: 'linear-gradient(180deg, rgba(22,163,74,.08), rgba(245,158,11,.08))' }}>
            <h3 style={{ marginTop: 0 }}>Quick tips</h3>
            <ul style={{ lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
              <li>Rotate who tees first to keep everyone involved.</li>
              <li>Enter team rounds from the Team Logger right after the match.</li>
              <li>Use the Teams page to keep rosters clean before the next event.</li>
            </ul>
            <div className="small" style={{ marginTop: 10 }}>
              Tip: Add your round in <strong>Golf Logger</strong> and track wins over time.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
