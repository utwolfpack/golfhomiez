export default function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div className="card statCardCompact">
      <div className="small statCardLabel">{title}</div>
      <div className="statCardValue">{value}</div>
      {subtitle ? <div className="small statCardSubtitle">{subtitle}</div> : null}
    </div>
  )
}
