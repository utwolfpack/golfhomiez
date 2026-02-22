export default function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div className="card">
      <div className="small">{title}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
      {subtitle ? <div className="small" style={{ marginTop: 6 }}>{subtitle}</div> : null}
    </div>
  )
}
