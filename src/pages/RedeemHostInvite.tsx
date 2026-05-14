import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'

export default function RedeemHostInvite() {
  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course access" title="Host invites have been retired" subtitle="Golf-course access is now created through the account request and approval workflow." />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn btnPrimary" to="/host/register">Request a golf-course account</Link>
          <Link className="btn" to="/host/login">Back to host login</Link>
        </div>
      </div>
    </div>
  )
}
