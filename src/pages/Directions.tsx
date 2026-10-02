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
            <h3 style={{ marginTop: 0 }}>Standard scramble</h3>
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
              <li>Use Challenges page Team Challenges to propose challenges, track team dialogue, and enter team scores.</li>
              <li>Use the Teams page to keep rosters clean before the next event.</li>
            </ul>
            <div className="small" style={{ marginTop: 10 }}>
              Tip: Use <strong>Team Challenges</strong> for team scoring and <strong>Log a Round</strong> for solo scores.
            </div>
          </div>
        </div>

        <div className="grid grid2" style={{ marginTop: 12 }}>
          <div className="card" style={{ background: 'rgba(255,247,237,.8)' }}>
            <h3 style={{ marginTop: 0 }}>Skins Team Challenge</h3>
            <ol style={{ lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
              <li>Create a <strong>Team Challenge</strong> and choose <strong>Skins</strong> as the team challenge game.</li>
              <li>Optionally enter how many <strong>points per hole</strong> each won hole is worth. Blank values use 1 point per hole.</li>
              <li>Both teams enter hole-by-hole scores from the challenge scorecard.</li>
              <li>The team with the lower score on a hole wins that hole’s points.</li>
              <li>If the hole is tied, no points are awarded for that hole.</li>
              <li>Open the Team Challenge leaderboard to track score, holes played, and the live points column relative to your team.</li>
            </ol>
          </div>

          <div className="card" style={{ background: 'rgba(240,253,244,.84)' }}>
            <h3 style={{ marginTop: 0 }}>Skins - Push Team Challenge</h3>
            <ol style={{ lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
              <li>Create a <strong>Team Challenge</strong> and choose <strong>Skins - Push</strong> as the team challenge game.</li>
              <li>Optionally enter how many <strong>dollars per hole</strong> each hole starts with. Blank values use $1 per hole.</li>
              <li>Both teams enter hole-by-hole scores from the challenge scorecard.</li>
              <li>The team with the lower score on a hole wins the available dollars.</li>
              <li>When the winning team wins by more than one stroke, each additional stroke adds the selected dollars-per-hole value again.</li>
              <li>If the hole is tied, the dollar value carries over to the next hole and keeps carrying over until a team wins a hole.</li>
              <li>The leaderboard shows awarded dollars and any pending carryover dollars that have not been won yet.</li>
            </ol>
          </div>
        </div>

        <div className="grid grid2" style={{ marginTop: 12 }}>
          <div className="card" style={{ background: 'rgba(255,247,237,.8)' }}>
            <h3 style={{ marginTop: 0 }}>Individual Skins Challenge</h3>
            <ol style={{ lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
              <li>Create an <strong>Individual Challenge</strong> and choose <strong>Skins</strong> as the individual challenge game.</li>
              <li>Each golfer records their own hole-by-hole score.</li>
              <li>A golfer must have the outright lowest score on a hole to win that hole.</li>
              <li>A tied low score is a push and awards no points; standard Skins does not carry pushed points forward.</li>
              <li>The leaderboard shows each hole's winner and score plus the worst score and the golfer or golfers who recorded it.</li>
            </ol>
          </div>

          <div className="card" style={{ background: 'rgba(240,253,244,.84)' }}>
            <h3 style={{ marginTop: 0 }}>Individual Skins - Push Challenge</h3>
            <ol style={{ lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
              <li>Create an <strong>Individual Challenge</strong> and choose <strong>Skins - Push</strong>.</li>
              <li>A golfer must have the outright lowest score on a hole; otherwise the hole pushes.</li>
              <li>On an outright win, the golfer earns the selected dollars-per-hole value for each stroke between their score and the worst score recorded on that hole.</li>
              <li>Dollars from pushed holes carry forward and are added to the next outright hole winner.</li>
              <li>The leaderboard shows the hole winner and score, the worst score and golfer name or names, pushed dollars, and dollars awarded.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
