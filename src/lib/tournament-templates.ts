export type TournamentTemplateKey = 'classic-flyer' | 'fairway-poster' | 'modern-open' | 'charity-tribute' | 'sunset-drive' | 'green-invite'

export const DEFAULT_TOURNAMENT_BANNER_URL = '/DefaultGolfBanner.jpg'
export const DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL = '/tournament-templates/DefaultCharityGrass.svg'
export const DEFAULT_TOURNAMENT_CHARITY_MESSAGE = 'Support the featured cause and help make this tournament a meaningful day on and off the course.'
export const DEFAULT_TOURNAMENT_CHECK_IN_TIME = '08:00'
export const DEFAULT_TOURNAMENT_TEE_TIME = '08:30'
export const DEFAULT_TEE_TIME_INTERVAL_MINUTES = 10

export const STANDARD_TOURNAMENT_FORMATS = [
  '2-Person Scramble',
  '4-Person Scramble',
  'Team Best Ball',
  'Team Shamble',
  'Four-Ball',
  'Alternate Shot',
  'Chapman / Pinehurst',
  'Team Stableford',
  'Team Match Play',
] as const

export type TournamentAttributeIconKey = 'date' | 'checkInTime' | 'teeTime' | 'course' | 'location' | 'format' | 'registrationFee'

export type TournamentTemplate = {
  key: TournamentTemplateKey
  name: string
  description: string
  accentColor: string
  previewClassName: string
  attributeIcons: Record<TournamentAttributeIconKey, string>
}

export type TournamentTemplateData = {
  hostOrganization?: string | null
  beneficiaryCharity?: string | null
  charityMessage?: string | null
  locationAddress?: string | null
  checkInTime?: string | null
  teeTime?: string | null
  teeTimeIntervalMinutes?: number | null
  startType?: 'shotgun' | 'tee-times' | string | null
  tournamentFormat?: string | null
  tournamentTeamSize?: number | null
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
  tournamentSummary?: string | null
  tournamentCourseMisc?: string | null
  sponsorsAvailable?: boolean | null
}

const DEFAULT_ATTRIBUTE_ICONS: Record<TournamentAttributeIconKey, string> = {
  date: '/tournament-templates/date.jpg',
  checkInTime: '/tournament-templates/tee-time.jpg',
  teeTime: '/tournament-templates/tee-time.jpg',
  course: '/tournament-templates/golf-course.jpg',
  location: '/tournament-templates/location.png',
  format: '/tournament-templates/format.jpg',
  registrationFee: '/tournament-templates/registration-fee.jpg',
}

export const TOURNAMENT_TEMPLATES: TournamentTemplate[] = [
  {
    key: 'classic-flyer',
    name: 'Classic Golf Homiez',
    description: 'Clean green-and-gold flyer with readable event rows, charity highlights, registration details, contact information, and sponsor logos.',
    accentColor: '#0f3f24',
    previewClassName: 'tournament-template-preview--classic',
    attributeIcons: DEFAULT_ATTRIBUTE_ICONS,
  },
  {
    key: 'fairway-poster',
    name: 'Fairway Poster',
    description: 'Bold photo-first event poster with a large tournament title, compact event facts, and a strong registration callout.',
    accentColor: '#174b22',
    previewClassName: 'tournament-template-preview--fairway',
    attributeIcons: DEFAULT_ATTRIBUTE_ICONS,
  },
  {
    key: 'modern-open',
    name: 'Modern Golf Open',
    description: 'Contemporary block layout with a strong hero image, high-contrast date and format details, and easy-to-scan information panels.',
    accentColor: '#244b17',
    previewClassName: 'tournament-template-preview--modern',
    attributeIcons: DEFAULT_ATTRIBUTE_ICONS,
  },
  {
    key: 'charity-tribute',
    name: 'Charity & Memorial',
    description: 'Charity-forward design that gives the beneficiary image and message extra emphasis while keeping tournament details easy to find.',
    accentColor: '#24440f',
    previewClassName: 'tournament-template-preview--charity',
    attributeIcons: DEFAULT_ATTRIBUTE_ICONS,
  },
  {
    key: 'sunset-drive',
    name: 'Sunset Drive',
    description: 'Image-led promotional flyer with oversized event branding, centered registration details, and sponsor visibility for a polished event-poster feel.',
    accentColor: '#41520d',
    previewClassName: 'tournament-template-preview--sunset',
    attributeIcons: DEFAULT_ATTRIBUTE_ICONS,
  },
  {
    key: 'green-invite',
    name: 'Green Invitation',
    description: 'Minimal invitation-style flyer inspired by a sculpted fairway edge, with bold vertical event typography and compact registration details.',
    accentColor: '#176b2c',
    previewClassName: 'tournament-template-preview--green-invite',
    attributeIcons: DEFAULT_ATTRIBUTE_ICONS,
  },
]

export const TOURNAMENT_TEMPLATE_KEYS = TOURNAMENT_TEMPLATES.map((template) => template.key)

export function getTournamentTemplate(key?: string | null) {
  return TOURNAMENT_TEMPLATES.find((template) => template.key === key) || TOURNAMENT_TEMPLATES[0]
}


export const TOURNAMENT_TEAM_SIZE_OPTIONS = [2, 3, 4] as const
export type TournamentTeamSize = typeof TOURNAMENT_TEAM_SIZE_OPTIONS[number]

export function getTournamentTeamSize(templateData?: TournamentTemplateData | null): TournamentTeamSize {
  const rawSize = Number(templateData?.tournamentTeamSize)
  if (TOURNAMENT_TEAM_SIZE_OPTIONS.includes(rawSize as TournamentTeamSize)) return rawSize as TournamentTeamSize
  const legacyMatch = String(templateData?.tournamentFormat || '').match(/\b([234])\b/)
  const legacySize = legacyMatch ? Number(legacyMatch[1]) : 4
  return TOURNAMENT_TEAM_SIZE_OPTIONS.includes(legacySize as TournamentTeamSize) ? legacySize as TournamentTeamSize : 4
}

export function emptyTournamentTemplateData(): TournamentTemplateData {
  return {
    hostOrganization: '',
    beneficiaryCharity: '',
    charityMessage: DEFAULT_TOURNAMENT_CHARITY_MESSAGE,
    locationAddress: '',
    checkInTime: DEFAULT_TOURNAMENT_CHECK_IN_TIME,
    teeTime: DEFAULT_TOURNAMENT_TEE_TIME,
    teeTimeIntervalMinutes: DEFAULT_TEE_TIME_INTERVAL_MINUTES,
    startType: 'shotgun',
    tournamentFormat: '',
    tournamentTeamSize: 4,
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
    tournamentSummary: '',
    tournamentCourseMisc: '',
    sponsorsAvailable: false,
  }
}
