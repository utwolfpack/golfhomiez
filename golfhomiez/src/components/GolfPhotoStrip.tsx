import sunriseImg from '../assets/gallery/fairway-sunrise.svg'
import cartImg from '../assets/gallery/golf-cart.svg'
import clubhouseImg from '../assets/gallery/clubhouse-twilight.svg'

type Variant = 'full' | 'compact'

const photos = [
  { src: sunriseImg, title: 'Sunrise tee time', subtitle: 'Start the round with a perfect fairway vibe.' },
  { src: cartImg, title: 'Cart path energy', subtitle: 'Quick-access score tracking between holes.' },
  { src: clubhouseImg, title: 'Clubhouse finish', subtitle: 'Wrap up rounds, rosters, and records in one place.' },
]

export default function GolfPhotoStrip({ variant = 'full' }: { variant?: Variant }) {
  return (
    <div className={`photoStrip photoStrip--${variant}`}>
      {photos.map((photo) => (
        <div key={photo.title} className="photoCard">
          <img src={photo.src} alt={photo.title} className="photoCardImg" />
          <div className="photoCardOverlay">
            <div className="photoCardTitle">{photo.title}</div>
            <div className="photoCardSubtitle">{photo.subtitle}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
