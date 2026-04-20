import type { ReactNode } from 'react'

type Props = {
  eyebrow?: string
  title: string
  subtitle?: string
  actions?: ReactNode
}

export default function PageHero({ eyebrow, title, subtitle, actions }: Props) {
  return (
    <div className="pageHero">
      <div>
        {eyebrow ? <div className="pageHeroEyebrow">{eyebrow}</div> : null}
        <h2 className="pageHeroTitle">{title}</h2>
        {subtitle ? <div className="pageHeroSubtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="pageHeroActions">{actions}</div> : null}
    </div>
  )
}
