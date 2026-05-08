export type TournamentTemplateKey = 'classic-flyer'

export const DEFAULT_TOURNAMENT_BANNER_URL = '/tournament-templates/TourneyBannerDefault.png'
export const DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL = '/tournament-templates/GolfHomiezGiving.png'
export const DEFAULT_TOURNAMENT_CHARITY_MESSAGE = 'Support the featured cause and help make this tournament a meaningful day on and off the course.'

export type TournamentAttributeIconKey = 'date' | 'checkInTime' | 'teeTime' | 'course' | 'location' | 'format' | 'registrationFee'

export type TournamentTemplate = {
  key: TournamentTemplateKey
  name: string
  description: string
  accentColor: string
  attributeIcons: Record<TournamentAttributeIconKey, string>
}

export type TournamentTemplateData = {
  hostOrganization?: string | null
  beneficiaryCharity?: string | null
  charityMessage?: string | null
  locationAddress?: string | null
  checkInTime?: string | null
  teeTime?: string | null
  startType?: 'shotgun' | 'tee-times' | string | null
  tournamentFormat?: string | null
  registrationDeadline?: string | null
  entryFee?: string | null
  feesInclude?: string | null
  prizeDetails?: string | null
  holeContestsExtras?: string | null
  contactPerson?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  logoFiles?: string[] | null
  supportingPhotoUrl?: string | null
  miscNotes?: string | null
  sponsorsAvailable?: boolean | null
}

export const TOURNAMENT_TEMPLATES: TournamentTemplate[] = [
  {
    key: 'classic-flyer',
    name: 'Classic tournament flyer',
    description: 'Clean green-and-gold flyer layout with readable event rows, uploaded tournament attribute icons, charity highlights, registration information, contact details, and sponsor logos.',
    accentColor: '#0f3f24',
    attributeIcons: {
      date: '/tournament-templates/date.jpg',
      checkInTime: '/tournament-templates/tee-time.jpg',
      teeTime: '/tournament-templates/tee-time.jpg',
      course: '/tournament-templates/golf-course.jpg',
      location: '/tournament-templates/location.png',
      format: '/tournament-templates/format.jpg',
      registrationFee: '/tournament-templates/registration-fee.jpg',
    },
  },
]

export function getTournamentTemplate(key?: string | null) {
  return TOURNAMENT_TEMPLATES.find((template) => template.key === key) || TOURNAMENT_TEMPLATES[0]
}

export function emptyTournamentTemplateData(): TournamentTemplateData {
  return {
    hostOrganization: '',
    beneficiaryCharity: '',
    charityMessage: DEFAULT_TOURNAMENT_CHARITY_MESSAGE,
    locationAddress: '',
    checkInTime: '',
    teeTime: '',
    startType: 'shotgun',
    tournamentFormat: '',
    registrationDeadline: '',
    entryFee: '',
    feesInclude: '',
    prizeDetails: '',
    holeContestsExtras: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    logoFiles: [],
    supportingPhotoUrl: '',
    miscNotes: '',
    sponsorsAvailable: false,
  }
}
