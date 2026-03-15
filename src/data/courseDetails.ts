import { UTAH_GOLF_COURSES } from './utahCourses'

export type CourseGeoPoint = { latitude: number; longitude: number }

export type CourseDetails = {
  name: string
  state: string
  city?: string
  latitude?: number
  longitude?: number
  par: number
  courseRating: number
  slopeRating: number
}

const CITY_COORDINATES_UT: Record<string, CourseGeoPoint> = {
  'American Fork': { latitude: 40.3769, longitude: -111.7958 },
  Bountiful: { latitude: 40.8894, longitude: -111.8808 },
  'Cedar City': { latitude: 37.6775, longitude: -113.0619 },
  'Cedar Hills': { latitude: 40.4141, longitude: -111.6944 },
  Eden: { latitude: 41.2966, longitude: -111.8458 },
  'Eagle Mountain': { latitude: 40.3141, longitude: -112.0069 },
  Ferron: { latitude: 39.093, longitude: -111.1438 },
  Farmington: { latitude: 40.98, longitude: -111.8874 },
  'Garden City': { latitude: 41.9466, longitude: -111.3963 },
  'Green River': { latitude: 38.9958, longitude: -110.1607 },
  Highland: { latitude: 40.4272, longitude: -111.7852 },
  Hurricane: { latitude: 37.1753, longitude: -113.2899 },
  Ivins: { latitude: 37.1686, longitude: -113.6791 },
  Layton: { latitude: 41.0602, longitude: -111.9711 },
  Lehi: { latitude: 40.3916, longitude: -111.8508 },
  Logan: { latitude: 41.73698, longitude: -111.83384 },
  Midway: { latitude: 40.5127, longitude: -111.4744 },
  Moab: { latitude: 38.5733, longitude: -109.5498 },
  Monticello: { latitude: 37.8716, longitude: -109.3429 },
  Morgan: { latitude: 41.0361, longitude: -111.6763 },
  Murray: { latitude: 40.6669, longitude: -111.88799 },
  Ogden: { latitude: 41.223, longitude: -111.9738 },
  Orem: { latitude: 40.2969, longitude: -111.6946 },
  'Park City': { latitude: 40.6461, longitude: -111.498 },
  'Parleys Canyon': { latitude: 40.7335, longitude: -111.7593 },
  Price: { latitude: 39.5994, longitude: -110.8107 },
  Provo: { latitude: 40.2338, longitude: -111.6585 },
  Roy: { latitude: 41.1616, longitude: -112.0263 },
  Sandy: { latitude: 40.56498, longitude: -111.83897 },
  'Salt Lake City': { latitude: 40.7608, longitude: -111.891 },
  'Saratoga Springs': { latitude: 40.3492, longitude: -111.9047 },
  Smithfield: { latitude: 41.8383, longitude: -111.8322 },
  Springville: { latitude: 40.1652, longitude: -111.6108 },
  'St. George': { latitude: 37.0965, longitude: -113.5684 },
  Sterling: { latitude: 39.1822, longitude: -111.6924 },
  'Stansbury Park': { latitude: 40.6377, longitude: -112.2966 },
  Tooele: { latitude: 40.5308, longitude: -112.2983 },
  Vernal: { latitude: 40.4555, longitude: -109.5287 },
  Washington: { latitude: 37.1305, longitude: -113.5083 },
  'West Bountiful': { latitude: 40.8938, longitude: -111.9013 },
  'West Jordan': { latitude: 40.6097, longitude: -111.9391 },
  'West Valley City': { latitude: 40.6916, longitude: -112.0011 },
}

const COURSE_OVERRIDES_UT: Record<string, Partial<CourseDetails>> = {
  'Black Desert Resort Golf Course': { par: 72, courseRating: 74.4, slopeRating: 133 },
  'Copper Rock Golf Course': { par: 72, courseRating: 73.1, slopeRating: 136 },
  'Sand Hollow Golf Course': { par: 72, courseRating: 74.0, slopeRating: 137 },
  'Sky Mountain Golf Course': { par: 72, courseRating: 70.8, slopeRating: 125 },
  'Southgate Golf Club': { par: 72, courseRating: 70.7, slopeRating: 124 },
  'Sunbrook Golf Course': { par: 72, courseRating: 71.8, slopeRating: 127 },
  'SunRiver Golf Club': { par: 72, courseRating: 72.8, slopeRating: 131 },
  'The Ledges of St. George': { par: 72, courseRating: 73.6, slopeRating: 135 },
  'Bonneville Golf Course': { par: 71, courseRating: 70.8, slopeRating: 127 },
  'Wasatch Mountain (Lake)': { par: 72, courseRating: 72.5, slopeRating: 129 },
  'Wasatch Mountain (Mountain)': { par: 72, courseRating: 71.6, slopeRating: 127 },
  'Soldier Hollow (Gold)': { par: 72, courseRating: 73.8, slopeRating: 134 },
  'Soldier Hollow (Silver)': { par: 72, courseRating: 71.9, slopeRating: 126 },
}

const UTAH_DETAILS: CourseDetails[] = UTAH_GOLF_COURSES.map((course) => {
  const point = course.city ? CITY_COORDINATES_UT[course.city] : undefined
  const override = COURSE_OVERRIDES_UT[course.name] || {}
  return {
    name: course.name,
    state: 'UT',
    city: course.city,
    latitude: point?.latitude,
    longitude: point?.longitude,
    par: override.par ?? 72,
    courseRating: override.courseRating ?? 72,
    slopeRating: override.slopeRating ?? 113,
  }
})

const SEEDED_DETAILS: CourseDetails[] = [
  { name: 'TPC Scottsdale', state: 'AZ', city: 'Scottsdale', latitude: 33.6401, longitude: -111.9109, par: 71, courseRating: 73.8, slopeRating: 138 },
  { name: 'We-Ko-Pa Golf Club', state: 'AZ', city: 'Fort McDowell', latitude: 33.6715, longitude: -111.6759, par: 72, courseRating: 72.4, slopeRating: 135 },
  { name: 'Pebble Beach Golf Links', state: 'CA', city: 'Pebble Beach', latitude: 36.5683, longitude: -121.9501, par: 72, courseRating: 75.5, slopeRating: 145 },
  { name: 'Torrey Pines (South)', state: 'CA', city: 'La Jolla', latitude: 32.9047, longitude: -117.252, par: 72, courseRating: 75.8, slopeRating: 144 },
  { name: 'Arrowhead Golf Club', state: 'CO', city: 'Littleton', latitude: 39.6148, longitude: -105.1521, par: 70, courseRating: 72.4, slopeRating: 145 },
  { name: 'Fossil Trace', state: 'CO', city: 'Golden', latitude: 39.7403, longitude: -105.2051, par: 72, courseRating: 72.3, slopeRating: 137 },
  { name: 'Bay Hill Club & Lodge', state: 'FL', city: 'Orlando', latitude: 28.4608, longitude: -81.5007, par: 72, courseRating: 75.7, slopeRating: 142 },
  { name: 'Sea Island (Seaside)', state: 'GA', city: 'St. Simons Island', latitude: 31.1683, longitude: -81.3882, par: 70, courseRating: 73.8, slopeRating: 142 },
  { name: 'Ko Olina Golf Club', state: 'HI', city: 'Kapolei', latitude: 21.3346, longitude: -158.1229, par: 72, courseRating: 72.9, slopeRating: 132 },
  { name: 'Circling Raven', state: 'ID', city: 'Worley', latitude: 47.3988, longitude: -116.8819, par: 72, courseRating: 75.0, slopeRating: 142 },
  { name: 'Harborside International', state: 'IL', city: 'Chicago', latitude: 41.6782, longitude: -87.5425, par: 72, courseRating: 73.5, slopeRating: 134 },
  { name: 'Brickyard Crossing', state: 'IN', city: 'Indianapolis', latitude: 39.7951, longitude: -86.2386, par: 72, courseRating: 72.1, slopeRating: 129 },
  { name: 'Colbert Hills', state: 'KS', city: 'Manhattan', latitude: 39.2478, longitude: -96.5794, par: 72, courseRating: 74.0, slopeRating: 139 },
  { name: 'Granite Links', state: 'MA', city: 'Quincy', latitude: 42.2503, longitude: -71.0176, par: 72, courseRating: 74.0, slopeRating: 135 },
  { name: 'Arcadia Bluffs', state: 'MI', city: 'Arcadia', latitude: 44.4895, longitude: -86.2394, par: 72, courseRating: 75.1, slopeRating: 146 },
  { name: 'Deacon’s Lodge', state: 'MN', city: 'Baxter', latitude: 46.3426, longitude: -94.2864, par: 72, courseRating: 74.0, slopeRating: 139 },
  { name: 'Payne’s Valley', state: 'MO', city: 'Hollister', latitude: 36.5984, longitude: -93.2174, par: 72, courseRating: 74.9, slopeRating: 137 },
  { name: 'Old Works', state: 'MT', city: 'Anaconda', latitude: 46.1135, longitude: -112.9635, par: 72, courseRating: 72.4, slopeRating: 134 },
  { name: 'Pinehurst No. 2', state: 'NC', city: 'Pinehurst', latitude: 35.1982, longitude: -79.4694, par: 72, courseRating: 76.5, slopeRating: 138 },
  { name: 'Shadow Creek (private)', state: 'NV', city: 'North Las Vegas', latitude: 36.2545, longitude: -115.0484, par: 72, courseRating: 74.3, slopeRating: 144 },
  { name: 'Bethpage Black', state: 'NY', city: 'Farmingdale', latitude: 40.7446, longitude: -73.4524, par: 71, courseRating: 77.5, slopeRating: 155 },
  { name: 'The Virtues Golf Club', state: 'OH', city: 'Nashport', latitude: 40.1046, longitude: -82.1846, par: 72, courseRating: 74.8, slopeRating: 142 },
  { name: 'Bandon Dunes', state: 'OR', city: 'Bandon', latitude: 43.1163, longitude: -124.4152, par: 72, courseRating: 74.1, slopeRating: 136 },
  { name: 'Oakmont (private)', state: 'PA', city: 'Oakmont', latitude: 40.5212, longitude: -79.8421, par: 71, courseRating: 77.5, slopeRating: 150 },
  { name: 'Harbour Town', state: 'SC', city: 'Hilton Head Island', latitude: 32.1414, longitude: -80.7946, par: 71, courseRating: 75.6, slopeRating: 148 },
  { name: 'Sweetens Cove', state: 'TN', city: 'South Pittsburg', latitude: 35.0074, longitude: -85.7065, par: 72, courseRating: 71.4, slopeRating: 125 },
  { name: 'PGA Frisco (Fields Ranch)', state: 'TX', city: 'Frisco', latitude: 33.2133, longitude: -96.8759, par: 72, courseRating: 75.5, slopeRating: 140 },
  { name: 'Kingsmill (River)', state: 'VA', city: 'Williamsburg', latitude: 37.2284, longitude: -76.7108, par: 71, courseRating: 74.2, slopeRating: 138 },
  { name: 'Chambers Bay', state: 'WA', city: 'University Place', latitude: 47.2027, longitude: -122.5774, par: 72, courseRating: 74.4, slopeRating: 136 },
  { name: 'Erin Hills', state: 'WI', city: 'Erin', latitude: 43.2443, longitude: -88.3755, par: 72, courseRating: 77.9, slopeRating: 145 },
]

const COURSE_DETAILS = [...UTAH_DETAILS, ...SEEDED_DETAILS]

const byState = new Map<string, CourseDetails[]>()
const byKey = new Map<string, CourseDetails>()

for (const detail of COURSE_DETAILS) {
  const state = detail.state.toUpperCase()
  const list = byState.get(state) || []
  list.push(detail)
  byState.set(state, list)
  byKey.set(`${state}::${detail.name.toLowerCase()}`, detail)
}

export function getCourseDetails(state: string, courseName: string): CourseDetails | null {
  const detail = byKey.get(`${String(state || '').toUpperCase()}::${String(courseName || '').toLowerCase()}`)
  if (detail) return detail
  const trimmedName = String(courseName || '').trim()
  if (!trimmedName) return null
  return {
    name: trimmedName,
    state: String(state || '').toUpperCase(),
    par: 72,
    courseRating: 72,
    slopeRating: 113,
  }
}

export function getStateCourseDetails(state: string): CourseDetails[] {
  return [...(byState.get(String(state || '').toUpperCase()) || [])].sort((a, b) => a.name.localeCompare(b.name))
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function distanceMeters(a: CourseGeoPoint, b: CourseGeoPoint) {
  const earthRadiusMeters = 6371000
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h))
}

export function findNearestCourseForState(state: string, point: CourseGeoPoint): CourseDetails | null {
  const candidates = getStateCourseDetails(state).filter((course) => typeof course.latitude === 'number' && typeof course.longitude === 'number')
  if (!candidates.length) return null
  return candidates.reduce((best, candidate) => {
    if (!best) return candidate
    const bestDistance = distanceMeters(point, { latitude: best.latitude as number, longitude: best.longitude as number })
    const candidateDistance = distanceMeters(point, { latitude: candidate.latitude as number, longitude: candidate.longitude as number })
    return candidateDistance < bestDistance ? candidate : best
  }, candidates[0] || null)
}

export function calculateHandicapDifferential(score: number, courseRating: number, slopeRating: number) {
  if (!Number.isFinite(score) || !Number.isFinite(courseRating) || !Number.isFinite(slopeRating) || slopeRating <= 0) return null
  return Math.round((((score - courseRating) * 113) / slopeRating) * 10) / 10
}

export function calculateHandicapIndex(differentials: number[]) {
  const valid = differentials.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!valid.length) return null
  const count = Math.min(valid.length, 20)
  const recent = valid.slice(0, count)
  const usedCount = count >= 20 ? 8 : count >= 16 ? 6 : count >= 12 ? 4 : count >= 8 ? 2 : 1
  const used = recent.slice(0, usedCount)
  const average = used.reduce((sum, value) => sum + value, 0) / used.length
  return Math.round(average * 10) / 10
}
