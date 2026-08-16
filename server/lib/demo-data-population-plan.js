import { createHash } from 'node:crypto'

export const DEMO_SEED_TAG = '[golfhomiez-showcase-data]'

export const DEMO_DATA_EMAILS = Object.freeze({
  user: 'utwolfpack+golfhomiezuser@gmail.com',
  host: 'utwolfpack+golfhomiezhost@gmail.com',
  organizer: 'utwolfpack+golfhomiezorganizer@gmail.com',
})

export const DEMO_POPULATION_TYPES = Object.freeze(['all', 'user', 'host', 'organizer'])

export const DEMO_HOST_GOLF_COURSE = Object.freeze({
  name: 'Golf Homiez Lake View',
  normalizedName: 'golf homiez lake view',
  stateCode: 'UT',
  stateName: 'Utah',
  county: 'Tooele',
  city: 'Tooele',
  address: '1888 Lake View Fairway Drive',
  postalCode: '84074',
  phone: '801 555 0188',
  websitePath: '/golfhomiezlakeviewut',
  publicPageSlug: 'golfhomiezlakeviewut',
  latitude: 40.5308,
  longitude: -112.2983,
  holesCount: 18,
  parTotal: 72,
  totalYardage: 6742,
  courseRating: 72.4,
  slopeRating: 138,
  courseType: 'Public',
})

export const DEMO_HOST_COURSE_HOLES = Object.freeze([
  { hole: 1, par: 4, yards: 410, strokeIndex: 13 },
  { hole: 2, par: 5, yards: 555, strokeIndex: 7 },
  { hole: 3, par: 3, yards: 190, strokeIndex: 17 },
  { hole: 4, par: 4, yards: 430, strokeIndex: 1 },
  { hole: 5, par: 4, yards: 450, strokeIndex: 11 },
  { hole: 6, par: 4, yards: 430, strokeIndex: 5 },
  { hole: 7, par: 5, yards: 570, strokeIndex: 3 },
  { hole: 8, par: 3, yards: 210, strokeIndex: 15 },
  { hole: 9, par: 4, yards: 447, strokeIndex: 9 },
  { hole: 10, par: 4, yards: 440, strokeIndex: 10 },
  { hole: 11, par: 4, yards: 460, strokeIndex: 2 },
  { hole: 12, par: 5, yards: 605, strokeIndex: 8 },
  { hole: 13, par: 3, yards: 175, strokeIndex: 18 },
  { hole: 14, par: 4, yards: 460, strokeIndex: 4 },
  { hole: 15, par: 4, yards: 415, strokeIndex: 6 },
  { hole: 16, par: 3, yards: 190, strokeIndex: 16 },
  { hole: 17, par: 4, yards: 345, strokeIndex: 14 },
  { hole: 18, par: 5, yards: 560, strokeIndex: 12 },
])

export const TOURNAMENT_TEMPLATE_KEYS = Object.freeze([
  'classic-flyer',
  'fairway-poster',
  'modern-open',
  'charity-tribute',
  'sunset-drive',
  'green-invite',
])

export const TOURNAMENT_STOCK_IMAGES = Object.freeze({
  flyerBanners: [
    'https://images.unsplash.com/photo-1752079304499-b5ad6bd0bd15?auto=format&fit=crop&fm=jpg&ixlib=rb-4.1.0&q=70&w=1800',
    'https://images.pexels.com/photos/35048314/pexels-photo-35048314.jpeg?auto=compress&cs=tinysrgb&w=1800',
  ],
  beneficiaryPhotos: [
    'https://images.pexels.com/photos/31264946/pexels-photo-31264946.jpeg?auto=compress&cs=tinysrgb&w=1200',
    'https://images.pexels.com/photos/35048314/pexels-photo-35048314.jpeg?auto=compress&cs=tinysrgb&w=1200',
  ],
  sponsorImages: [
    'https://images.unsplash.com/photo-1752079304499-b5ad6bd0bd15?auto=format&fit=crop&fm=jpg&ixlib=rb-4.1.0&q=70&w=900',
    'https://images.pexels.com/photos/31264946/pexels-photo-31264946.jpeg?auto=compress&cs=tinysrgb&w=900',
    'https://images.pexels.com/photos/35048314/pexels-photo-35048314.jpeg?auto=compress&cs=tinysrgb&w=900',
  ],
})

function pickTournamentStockImage(kind, index) {
  const collection = TOURNAMENT_STOCK_IMAGES[kind] || []
  return collection.length ? collection[Math.abs(Number(index) || 0) % collection.length] : null
}

function pickTournamentSponsorImages(index) {
  return Array.from({ length: 4 }, (_, offset) => pickTournamentStockImage('sponsorImages', index + offset)).filter(Boolean)
}

const DEMO_STATES = Object.freeze(['UT', 'AZ', 'CO', 'NV', 'ID', 'TX'])
const DEMO_COURSES = Object.freeze([
  'Bonneville Golf Course',
  'Soldier Hollow Golf Course',
  'Wasatch Mountain Lake Course',
  'Mountain Dell Canyon Course',
  'Bountiful Ridge Golf Course',
  'Thanksgiving Point Golf Club',
  'The Oaks at Spanish Fork',
  'Sand Hollow Resort Championship Course',
])

const PLAYER_NAMES = Object.freeze([
  'Avery Stone', 'Jordan Mitchell', 'Parker Brooks', 'Cameron Hayes', 'Riley Morgan',
  'Logan Bennett', 'Taylor Reed', 'Casey Monroe', 'Morgan Ellis', 'Quinn Foster',
  'Hayden Parker', 'Blake Sullivan', 'Reese Carter', 'Dylan Porter', 'Sawyer Lane',
  'Emerson Brooks', 'Kai Jensen', 'Rowan Blake', 'Dakota Miller', 'Finley Hayes',
  'Harper Collins', 'Jamie Walker', 'Kendall Price', 'Skyler Hughes', 'Micah Grant',
])

const PROPOSER_TEAM_NAMES = Object.freeze([
  'Lake View Legends',
  'Wasatch Fairway Club',
  'Copper Canyon Collective',
  'Tooele Tee Crew',
  'Cedar Ridge Players',
])

const RIVAL_TEAM_NAMES = Object.freeze([
  'Summit Ridge Strikers',
  'Desert Links League',
  'Red Rock Rollers',
  'Valley Greens Crew',
  'Mountain View Match Play',
  'Silver Lake Shooters',
  'Canyon Pines Club',
  'Highland Approach Team',
  'Sunset Scramble Squad',
  'Juniper Ridge Golfers',
  'Eagle Crest Players',
  'Maple Hills Match Team',
  'Riverbend Range Crew',
  'Oak Hollow League',
  'Blue Tee Travelers',
])

const TOURNAMENT_NAMES = Object.freeze([
  'Lake View Invitational', 'Wasatch Spring Classic', 'Tooele Charity Scramble', 'Copper Canyon Open',
  'Fairway Friends Fundraiser', 'Sunset Drive Championship', 'Cedar Ridge Member Guest', 'Mountain Cup',
  'High Desert Best Ball', 'Eagle Flight Invitational', 'Green Jacket Weekend', 'Lake View Summer Shootout',
  'Back Nine Bash', 'Ridge Line Open', 'Birdies for Families', 'Community Cup Classic',
  'Founders Fairway Tournament', 'Stars and Stripes Scramble', 'Golden Hour Golf Classic', 'Utah Links Challenge',
  'First Tee Benefit', 'Player Appreciation Open', 'Corporate Cup Scramble', 'Four Ball Finale',
  'Autumn Approach Classic', 'Lake View Match Play', 'The Par Three Challenge', 'Greenside Gathering',
  'Canyon View Cup', 'Long Drive Open', 'Pin Seeker Classic', 'The Putting Green Party',
  'Sponsor Showcase Scramble', 'Veterans Fairway Benefit', 'School Spirit Golf Classic', 'Harvest Hills Open',
  'Desert Sunrise Invitational', 'The Weekend Warrior Cup', 'Fairways and Food Trucks', 'Club Champion Preview',
  'Nine and Dine Championship', 'Couples Classic', 'Junior Golf Benefit', 'Women on the Green Classic',
  'Blue Tee Challenge', 'White Tee Invitational', 'Red Rock Charity Open', 'Lake View Pro Am',
  'End of Season Cup', 'Winter Warm-Up Scramble', 'Spring Swing Social', 'Summer Solstice Shootout',
  'Patio Party Open', 'Neighborhood Cup', 'The Mulligan Classic', 'Drive for Hope',
  'Birdie Bash', 'Eagle Hunt Open', 'Fairway Fest', 'Championship Tune-Up',
])

const HOST_ORGANIZATIONS = Object.freeze([
  'Golf Homiez Lake View',
  'Lake View Golf Association',
  'Tooele Community Golf',
  'Wasatch Fairway Events',
])

const BENEFICIARY_CHARITIES = Object.freeze([
  'Tooele Youth Sports Fund',
  'Wasatch Junior Golf Foundation',
  'Lake View Veterans Outreach',
  'Community Food Pantry of Tooele',
  'Utah First Tee Scholarship Fund',
  'Mountain West Family Support',
])

const TEAM_CHALLENGE_STATUS_SEQUENCE = Object.freeze(['proposed', 'accepted', 'completed'])
const INDIVIDUAL_PARTICIPANT_COUNTS = Object.freeze([5, 7, 9, 11, 13, 15, 17, 19, 21, 25])

export function normalizePopulationType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!DEMO_POPULATION_TYPES.includes(normalized)) {
    throw new Error(`Unsupported demo data population type "${value}". Expected one of: ${DEMO_POPULATION_TYPES.join(', ')}`)
  }
  return normalized
}

export function normalizeDemoEmail(value, fallback) {
  const normalized = String(value || fallback || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`Invalid demo data email address: ${value || fallback || ''}`)
  }
  return normalized
}

export function stableDemoId(prefix, ...parts) {
  const hash = createHash('sha256')
    .update([prefix, ...parts].map((part) => String(part || '').toLowerCase()).join('|'))
    .digest('hex')

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${((Number.parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-')
}

function titleCase(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function displayNameFromEmail(email, suffix = '') {
  const localPart = String(email || '').split('@')[0]
  const base = titleCase(localPart.replace(/^utwolfpack\+/, '').replace(/^golfhomiez/, 'GolfHomiez ')) || 'GolfHomiez User'
  return suffix ? `${base} ${suffix}` : base
}

function isoDateAtOffset(index, total, start = '2025-01-10', end = '2026-08-20') {
  const startTime = Date.parse(`${start}T00:00:00Z`)
  const endTime = Date.parse(`${end}T00:00:00Z`)
  const ratio = total <= 1 ? 0 : index / (total - 1)
  return new Date(Math.round(startTime + ((endTime - startTime) * ratio))).toISOString().slice(0, 10)
}

function startOfTodayUtc() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function isoDateDaysFromToday(days) {
  const date = startOfTodayUtc()
  date.setUTCDate(date.getUTCDate() + Number(days || 0))
  return date.toISOString().slice(0, 10)
}

function isoDateDaysFromIso(value, days) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + Number(days || 0))
  return date.toISOString().slice(0, 10)
}

function tournamentDateForIndex(index, futureCount) {
  if (index < futureCount) return isoDateDaysFromToday(14 + (index * 7))
  return isoDateDaysFromToday(-30 - ((index - futureCount) * 21))
}

export function buildHoleScores(total, holes = 18, baseScore = 4) {
  const minPerHole = 2
  const maxPerHole = 8
  const values = new Array(holes).fill(baseScore)
  let delta = total - (holes * baseScore)
  let index = 0
  while (delta !== 0 && index < 10000) {
    const hole = index % holes
    if (delta > 0 && values[hole] < maxPerHole) {
      values[hole] += 1
      delta -= 1
    } else if (delta < 0 && values[hole] > minPerHole) {
      values[hole] -= 1
      delta += 1
    }
    index += 1
  }
  if (delta !== 0) throw new Error(`Could not generate hole scores for total ${total}`)
  return values
}

export function buildHoleDetails(total, holes = 18, holeMetadata = DEMO_HOST_COURSE_HOLES, teeColor = 'white') {
  const scores = buildHoleScores(total, holes)
  const metadata = Array.isArray(holeMetadata) && holeMetadata.length ? holeMetadata : DEMO_HOST_COURSE_HOLES
  return scores.map((score, index) => {
    const hole = metadata[index % metadata.length] || {}
    return {
      hole: Number(hole.hole || hole.holeNumber || hole.hole_number || index + 1),
      par: Number(hole.par) || null,
      yards: Number(hole.yards) || null,
      strokeIndex: Number(hole.strokeIndex || hole.stroke_index) || index + 1,
      teeColor: String(hole.teeColor || hole.tee_color || teeColor || 'white'),
      teeBoxType: String(hole.teeBoxType || hole.tee_box_type || hole.teeName || hole.tee_name || teeColor || 'white'),
      frontLatitude: Number.isFinite(Number(hole.frontLatitude ?? hole.front_latitude)) ? Number(hole.frontLatitude ?? hole.front_latitude) : null,
      frontLongitude: Number.isFinite(Number(hole.frontLongitude ?? hole.front_longitude)) ? Number(hole.frontLongitude ?? hole.front_longitude) : null,
      centerLatitude: Number.isFinite(Number(hole.centerLatitude ?? hole.center_latitude)) ? Number(hole.centerLatitude ?? hole.center_latitude) : null,
      centerLongitude: Number.isFinite(Number(hole.centerLongitude ?? hole.center_longitude)) ? Number(hole.centerLongitude ?? hole.center_longitude) : null,
      backLatitude: Number.isFinite(Number(hole.backLatitude ?? hole.back_latitude)) ? Number(hole.backLatitude ?? hole.back_latitude) : null,
      backLongitude: Number.isFinite(Number(hole.backLongitude ?? hole.back_longitude)) ? Number(hole.backLongitude ?? hole.back_longitude) : null,
      score,
      scoreProvided: true,
    }
  })
}


export function buildSkinsPushHoleDetails(total, holes = 18, holeMetadata = DEMO_HOST_COURSE_HOLES, teeColor = 'white', teamSide = 'proposer') {
  const baseline = buildHoleScores(total, holes)
  const metadata = Array.isArray(holeMetadata) && holeMetadata.length ? holeMetadata : DEMO_HOST_COURSE_HOLES
  const tieHoles = new Set([1, 2, 5, 9, 13, 17])
  const swingHoles = new Set([3, 6, 10, 14, 18])
  const rawScores = baseline.map((score, index) => {
    const holeNumber = index + 1
    if (tieHoles.has(holeNumber)) return Number(metadata[index % metadata.length]?.par) || score
    if (teamSide === 'proposer' && swingHoles.has(holeNumber)) return Math.max(2, score - 1)
    if (teamSide === 'challenged' && swingHoles.has(holeNumber)) return Math.min(8, score + 1)
    return score
  })
  const currentTotal = rawScores.reduce((sum, score) => sum + score, 0)
  let delta = total - currentTotal
  let guard = 0
  while (delta !== 0 && guard < 10000) {
    const index = guard % rawScores.length
    const holeNumber = index + 1
    if (!tieHoles.has(holeNumber)) {
      if (delta > 0 && rawScores[index] < 8) {
        rawScores[index] += 1
        delta -= 1
      } else if (delta < 0 && rawScores[index] > 2) {
        rawScores[index] -= 1
        delta += 1
      }
    }
    guard += 1
  }
  return rawScores.map((score, index) => {
    const hole = metadata[index % metadata.length] || {}
    return {
      hole: Number(hole.hole || hole.holeNumber || hole.hole_number || index + 1),
      par: Number(hole.par) || null,
      yards: Number(hole.yards) || null,
      strokeIndex: Number(hole.strokeIndex || hole.stroke_index) || index + 1,
      teeColor: String(hole.teeColor || hole.tee_color || teeColor || 'white'),
      teeBoxType: String(hole.teeBoxType || hole.tee_box_type || hole.teeName || hole.tee_name || teeColor || 'white'),
      frontLatitude: Number.isFinite(Number(hole.frontLatitude ?? hole.front_latitude)) ? Number(hole.frontLatitude ?? hole.front_latitude) : null,
      frontLongitude: Number.isFinite(Number(hole.frontLongitude ?? hole.front_longitude)) ? Number(hole.frontLongitude ?? hole.front_longitude) : null,
      centerLatitude: Number.isFinite(Number(hole.centerLatitude ?? hole.center_latitude)) ? Number(hole.centerLatitude ?? hole.center_latitude) : null,
      centerLongitude: Number.isFinite(Number(hole.centerLongitude ?? hole.center_longitude)) ? Number(hole.centerLongitude ?? hole.center_longitude) : null,
      backLatitude: Number.isFinite(Number(hole.backLatitude ?? hole.back_latitude)) ? Number(hole.backLatitude ?? hole.back_latitude) : null,
      backLongitude: Number.isFinite(Number(hole.backLongitude ?? hole.back_longitude)) ? Number(hole.backLongitude ?? hole.back_longitude) : null,
      score,
      scoreProvided: true,
    }
  })
}

export function buildDemoSoloRounds(userEmail = DEMO_DATA_EMAILS.user) {
  return Array.from({ length: 40 }, (_, index) => {
    const score = 76 + ((index * 5) % 17)
    return {
      id: stableDemoId('demo-score', userEmail, index),
      date: isoDateAtOffset(index, 40),
      golfCourseId: null,
      state: DEMO_STATES[index % DEMO_STATES.length],
      course: DEMO_COURSES[index % DEMO_COURSES.length],
      score,
      teeColor: ['white', 'blue', 'black', 'red'][index % 4],
      holes: buildHoleScores(score),
    }
  })
}

function personName(index) {
  return PLAYER_NAMES[index % PLAYER_NAMES.length]
}

function demoParticipant(challengeEmail, challengeIndex, participantIndex) {
  const isOwner = participantIndex === 0
  const email = isOwner
    ? challengeEmail
    : `utwolfpack+lakeview.challenge.${challengeIndex + 1}.${participantIndex}@gmail.com`
  const score = 76 + ((challengeIndex + participantIndex * 3) % 19)
  return {
    userId: isOwner ? stableDemoId('demo-auth-user', challengeEmail) : null,
    email,
    name: isOwner ? displayNameFromEmail(challengeEmail) : personName(challengeIndex + participantIndex),
    score,
    holes: buildHoleDetails(score),
    soloScoreId: isOwner ? stableDemoId('demo-score-individual-challenge', challengeEmail, challengeIndex) : null,
  }
}

export function buildDemoTeamChallenges(userEmail = DEMO_DATA_EMAILS.user) {
  return Array.from({ length: 15 }, (_, index) => {
    const proposerTotal = 59 + (index % 11)
    const challengedTotal = 60 + ((index * 2) % 10)
    return {
      id: stableDemoId('demo-team-challenge', userEmail, index),
      date: isoDateAtOffset(index, 15, '2025-02-01', '2026-07-15'),
      golfCourseId: null,
      state: DEMO_STATES[index % DEMO_STATES.length],
      course: DEMO_COURSES[(index + 2) % DEMO_COURSES.length],
      proposerTeamName: PROPOSER_TEAM_NAMES[index % PROPOSER_TEAM_NAMES.length],
      challengedTeamName: RIVAL_TEAM_NAMES[index % RIVAL_TEAM_NAMES.length],
      status: TEAM_CHALLENGE_STATUS_SEQUENCE[index % TEAM_CHALLENGE_STATUS_SEQUENCE.length],
      scoringType: index % 5 === 0 ? 'skins_push' : index % 4 === 0 ? 'skins' : 'stroke_play',
      pointsPerHole: index % 5 === 0 ? 2 : null,
      proposerTotal,
      challengedTotal,
      teeColor: ['white', 'blue', 'black'][index % 3],
      proposerHoles: buildHoleDetails(proposerTotal),
      challengedHoles: buildHoleDetails(challengedTotal),
    }
  })
}

export function buildDemoIndividualChallenges(userEmail = DEMO_DATA_EMAILS.user) {
  return INDIVIDUAL_PARTICIPANT_COUNTS.map((participantCount, index) => ({
    id: stableDemoId('demo-individual-challenge', userEmail, index),
    date: isoDateAtOffset(index, INDIVIDUAL_PARTICIPANT_COUNTS.length, '2025-03-15', '2026-08-01'),
    golfCourseId: null,
    state: DEMO_STATES[(index + 3) % DEMO_STATES.length],
    course: DEMO_COURSES[(index + 4) % DEMO_COURSES.length],
    status: index % 3 === 0 ? 'completed' : index % 3 === 1 ? 'accepted' : 'proposed',
    teeColor: ['white', 'blue', 'red'][index % 3],
    participantCount,
    participants: Array.from({ length: participantCount }, (_, participantIndex) => demoParticipant(userEmail, index, participantIndex)),
  }))
}

function buildTemplateData({ tournamentIndex, startType, contactEmail, imageMode, startDate, isFutureDated }) {
  const checkInHour = 7 + (tournamentIndex % 3)
  const teeHour = checkInHour + 1
  const tournamentFormat = ['4-Person Scramble', '2-Person Scramble', 'Team Best Ball', 'Team Shamble'][tournamentIndex % 4]
  const customImagesEnabled = imageMode === 'custom'
  return {
    hostOrganization: HOST_ORGANIZATIONS[tournamentIndex % HOST_ORGANIZATIONS.length],
    beneficiaryCharity: BENEFICIARY_CHARITIES[tournamentIndex % BENEFICIARY_CHARITIES.length],
    charityMessage: isFutureDated
      ? 'Tournament proceeds support local golf access, junior players, and families connected to the course community.'
      : 'The event brought players, sponsors, and course partners together for a competitive community golf day.',
    locationAddress: `${100 + tournamentIndex} Lake View Fairway, ${DEMO_HOST_GOLF_COURSE.city}, ${DEMO_HOST_GOLF_COURSE.stateCode}`,
    checkInTime: `${String(checkInHour).padStart(2, '0')}:00`,
    teeTime: `${String(teeHour).padStart(2, '0')}:00`,
    teeTimeIntervalMinutes: startType === 'tee-times' ? 10 + ((tournamentIndex % 3) * 5) : 10,
    startType,
    tournamentFormat,
    registrationDeadline: isoDateDaysFromIso(startDate, -14),
    entryFee: `$${95 + ((tournamentIndex % 8) * 10)}`,
    feesInclude: 'Green fee and cart\nRange balls\nLive GolfHomiez scoring\nPost-round awards',
    prizeDetails: 'Closest to the pin\nLong drive\nSkins game\nFlight winner payouts',
    holeContestsExtras: tournamentIndex % 2 === 0 ? 'Putting contest\nRaffle prizes\nSponsor games' : 'Mulligan package\nLongest putt\nBeat-the-pro contest',
    contactPerson: personName(tournamentIndex + 3),
    contactPhone: '801 555 0100',
    contactEmail,
    logoFiles: customImagesEnabled ? pickTournamentSponsorImages(tournamentIndex) : [],
    sponsorImageUrls: customImagesEnabled ? pickTournamentSponsorImages(tournamentIndex + 2) : [],
    supportingPhotoUrl: customImagesEnabled ? pickTournamentStockImage('beneficiaryPhotos', tournamentIndex) : '/tournament-templates/DefaultCharityGrass.svg',
    miscNotes: startType === 'shotgun'
      ? 'All groups start together after the player briefing. Scores post live as teams complete each hole.'
      : 'Pairings move through scheduled tee times. Players should arrive at least forty-five minutes early for check-in.',
    tournamentSummary: isFutureDated
      ? 'A polished golf event experience for players, teams, sponsors, and course partners.'
      : 'A completed golf event with posted pairings, scoring history, and leaderboard results.',
    sponsorsAvailable: tournamentIndex % 3 === 0,
  }
}

export function buildDemoTournaments({ ownerType, ownerEmail, associatedEmail, count, futureCount }) {
  const requestedFutureCount = Number.isFinite(Number(futureCount)) ? Number(futureCount) : Math.ceil(count * 0.7)
  return Array.from({ length: count }, (_, index) => {
    const templateKey = TOURNAMENT_TEMPLATE_KEYS[index % TOURNAMENT_TEMPLATE_KEYS.length]
    const startType = index % 2 === 0 ? 'shotgun' : 'tee-times'
    const imageMode = index % 3 === 0 ? 'custom' : 'default'
    const date = tournamentDateForIndex(index, requestedFutureCount)
    const isFutureDated = index < requestedFutureCount
    const baseName = TOURNAMENT_NAMES[index % TOURNAMENT_NAMES.length]
    const seasonLabel = isFutureDated ? 'Upcoming' : 'Recap'
    const title = `${baseName} ${date.slice(0, 4)}`
    return {
      id: stableDemoId(`demo-${ownerType}-tournament`, ownerEmail, index),
      tournamentIdentifier: stableDemoId(`demo-${ownerType}-public-id`, ownerEmail, index).slice(0, 32),
      portalSlug: `${seasonLabel.toLowerCase()}-${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${stableDemoId('slug', ownerEmail, index).slice(-6)}`,
      golfCourseName: DEMO_HOST_GOLF_COURSE.name,
      golfCourseStateCode: DEMO_HOST_GOLF_COURSE.stateCode,
      golfCourseCity: DEMO_HOST_GOLF_COURSE.city,
      golfCourseWebsitePath: DEMO_HOST_GOLF_COURSE.websitePath,
      name: title,
      title,
      description: `${title} brings golfers together at ${DEMO_HOST_GOLF_COURSE.name} for ${startType === 'shotgun' ? 'a shotgun start' : 'scheduled tee times'}, team scoring, sponsor visibility, and a smooth registration experience.`,
      startDate: date,
      startDateTime: `${date} ${startType === 'shotgun' ? '08:00:00' : '08:30:00'}`,
      endDate: date,
      status: isFutureDated ? 'published' : 'completed',
      isPublic: true,
      templateKey,
      templateBackgroundImageUrl: imageMode === 'custom' ? pickTournamentStockImage('flyerBanners', index) : null,
      templateData: buildTemplateData({ tournamentIndex: index, templateKey, startType, contactEmail: ownerEmail, imageMode, startDate: date, isFutureDated }),
      teamSlotLimit: 24 + (index % 8),
      associatedEmail,
      startType,
      imageMode,
      isFutureDated,
      tournamentIndex: index,
    }
  })
}

export function buildDemoDataPlan(overrides = {}) {
  const userEmail = normalizeDemoEmail(overrides.userEmail, DEMO_DATA_EMAILS.user)
  const hostEmail = normalizeDemoEmail(overrides.hostEmail, DEMO_DATA_EMAILS.host)
  const organizerEmail = normalizeDemoEmail(overrides.organizerEmail, DEMO_DATA_EMAILS.organizer)
  return {
    emails: { user: userEmail, host: hostEmail, organizer: organizerEmail },
    user: {
      email: userEmail,
      soloRounds: buildDemoSoloRounds(userEmail),
      teamChallenges: buildDemoTeamChallenges(userEmail),
      individualChallenges: buildDemoIndividualChallenges(userEmail),
    },
    host: {
      email: hostEmail,
      organizerEmail,
      tournaments: buildDemoTournaments({ ownerType: 'host', ownerEmail: hostEmail, associatedEmail: organizerEmail, count: 50, futureCount: 35 }),
      associatedOrganizerTournamentCount: 10,
      futureTournamentCount: 35,
      pastTournamentCount: 15,
    },
    organizer: {
      email: organizerEmail,
      hostEmail,
      tournaments: buildDemoTournaments({ ownerType: 'organizer', ownerEmail: organizerEmail, associatedEmail: hostEmail, count: 10, futureCount: 7 }),
      associatedHostTournamentCount: 10,
      futureTournamentCount: 7,
      pastTournamentCount: 3,
    },
  }
}

export function summarizeDemoPlan(plan = buildDemoDataPlan()) {
  return {
    user: {
      email: plan.user.email,
      soloRounds: plan.user.soloRounds.length,
      teamChallenges: plan.user.teamChallenges.length,
      individualChallenges: plan.user.individualChallenges.length,
      individualChallengeParticipantRange: [
        Math.min(...plan.user.individualChallenges.map((challenge) => challenge.participantCount)),
        Math.max(...plan.user.individualChallenges.map((challenge) => challenge.participantCount)),
      ],
    },
    host: {
      email: plan.host.email,
      tournaments: plan.host.tournaments.length,
      futureTournaments: plan.host.tournaments.filter((tournament) => tournament.isFutureDated).length,
      pastTournaments: plan.host.tournaments.filter((tournament) => !tournament.isFutureDated).length,
      templates: [...new Set(plan.host.tournaments.map((tournament) => tournament.templateKey))],
      startTypes: [...new Set(plan.host.tournaments.map((tournament) => tournament.startType))],
      imageModes: [...new Set(plan.host.tournaments.map((tournament) => tournament.imageMode))],
      associatedOrganizerEmail: plan.host.organizerEmail,
      associatedOrganizerTournamentCount: plan.host.associatedOrganizerTournamentCount,
    },
    organizer: {
      email: plan.organizer.email,
      tournaments: plan.organizer.tournaments.length,
      futureTournaments: plan.organizer.tournaments.filter((tournament) => tournament.isFutureDated).length,
      pastTournaments: plan.organizer.tournaments.filter((tournament) => !tournament.isFutureDated).length,
      templates: [...new Set(plan.organizer.tournaments.map((tournament) => tournament.templateKey))],
      startTypes: [...new Set(plan.organizer.tournaments.map((tournament) => tournament.startType))],
      imageModes: [...new Set(plan.organizer.tournaments.map((tournament) => tournament.imageMode))],
      associatedHostEmail: plan.organizer.hostEmail,
      associatedHostTournamentCount: plan.organizer.associatedHostTournamentCount,
    },
  }
}
