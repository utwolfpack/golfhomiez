export default function Directions() {
  return (
    <div className="container">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Directions to Scramble</h2>
        <ol style={{ lineHeight: 1.6 }}>
          <li><strong>Form teams</strong> (2–4 players per team). Decide team names.</li>
          <li><strong>Tee off</strong> and each player hits a shot.</li>
          <li><strong>Choose the best ball</strong> among the team’s shots.</li>
          <li><strong>All players play from that spot</strong> (place ball within one club length, no closer to hole, unless local rules differ).</li>
          <li>Repeat until the ball is holed. Record the <strong>team score</strong> for the hole.</li>
          <li>After 18 holes, compare totals. Lower total wins.</li>
        </ol>
        <div className="small">
          Tip: Add your round in <strong>Golf Logger</strong> and track wins + money over time.
        </div>
      </div>
    </div>
  )
}
