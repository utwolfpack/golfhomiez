const CITY_COORDINATES_UT = {
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
  Logan: { latitude: 41.737, longitude: -111.8338 },
  Midway: { latitude: 40.5127, longitude: -111.4744 },
  Moab: { latitude: 38.5733, longitude: -109.5498 },
  Monticello: { latitude: 37.8716, longitude: -109.3429 },
  Morgan: { latitude: 41.0361, longitude: -111.6763 },
  Murray: { latitude: 40.6669, longitude: -111.888 },
  Ogden: { latitude: 41.223, longitude: -111.9738 },
  Orem: { latitude: 40.2969, longitude: -111.6946 },
  'Park City': { latitude: 40.6461, longitude: -111.498 },
  'Parleys Canyon': { latitude: 40.7335, longitude: -111.7593 },
  Price: { latitude: 39.5994, longitude: -110.8107 },
  Provo: { latitude: 40.2338, longitude: -111.6585 },
  Roy: { latitude: 41.1616, longitude: -112.0263 },
  Sandy: { latitude: 40.565, longitude: -111.839 },
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

const utahCourses = [
  ['Alpine Country Club', 'Highland'], ['Bear Lake Golf Course', 'Garden City'], ['Ben Lomond Golf Course', 'Ogden'], ['Birch Creek Golf Course', 'Smithfield'], ['Black Desert Resort Golf Course', 'Ivins'], ['Bloomington Country Club', 'St. George'], ['Bonneville Golf Course', 'Salt Lake City'], ['Bountiful Ridge Golf Course', 'Bountiful'], ['Carbon Country Club', 'Price'], ['Cascades Golf Course', 'Orem'], ['Cedar Hills Golf Club', 'Cedar Hills'], ['Cedar Ridge Golf Course', 'Cedar City'], ['Copper Rock Golf Course', 'Hurricane'], ['Coral Canyon Golf Club', 'Washington'], ['Cottonwood Country Club', 'Salt Lake City'], ['Davis Park Golf Course', 'Layton'], ['Dinaland Golf Course', 'Vernal'], ['Dixie Red Hills Golf Course', 'St. George'], ['Eagle Lake Golf Course', 'Roy'], ['Eagle Mountain Golf Course', 'Eagle Mountain'], ['Eaglewood Golf Course', 'North Salt Lake'], ['East Bay Golf Course', 'Provo'], ['Entrada at Snow Canyon Country Club', 'St. George'], ['Forest Dale Golf Course', 'Salt Lake City'], ['Fox Hollow Golf Club', 'American Fork'], ['Glenmoor Golf Club', 'South Jordan'], ['Glenwild Golf Club', 'Park City'], ['Golf City', 'Salt Lake City'], ['Green River State Park Golf Course', 'Green River'], ['Green Spring Golf Course', 'Washington'], ['Hobble Creek Golf Course', 'Springville'], ['Homestead Golf Club', 'Midway'], ['Jeremy Ranch Golf & Country Club', 'Park City'], ['Jordan River Par 3', 'West Jordan'], ['Lakeside Golf Course', 'West Bountiful'], ['Logan River Golf Course', 'Logan'], ['Meadow Brook Golf Course', 'Salt Lake City'], ['Mick Riley Golf Course', 'Murray'], ['Millsite Golf Course', 'Ferron'], ['Moab Golf Club', 'Moab'], ['Mount Ogden Golf Course', 'Ogden'], ['Mountain Dell Golf Course', 'Parleys Canyon'], ['Murray Parkway Golf Course', 'Murray'], ['Nibley Park Golf Course', 'Salt Lake City'], ['Oakridge Country Club', 'Farmington'], ['Ogden Golf & Country Club', 'Ogden'], ['Old Mill Golf Course', 'Salt Lake City'], ['Palisade State Park Golf Course', 'Sterling'], ['Park City Golf Club', 'Park City'], ['Promontory Club (Pete Dye)', 'Park City'], ['River Oaks Golf Course', 'Sandy'], ['Riverbend Golf Course', 'West Jordan'], ['Rose Park Golf Course', 'Salt Lake City'], ['Round Valley Golf Course', 'Morgan'], ['Sand Hollow Golf Course', 'Hurricane'], ["Schneiter's Pebblebrook Links", 'Sandy'], ["Schneiter's Riverside Golf", 'Salt Lake City'], ['Sky Mountain Golf Course', 'Hurricane'], ['Soldier Hollow (Gold)', 'Midway'], ['Soldier Hollow (Silver)', 'Midway'], ['Southgate Golf Club', 'St. George'], ['St. George Golf Club', 'St. George'], ['Stansbury Park Golf Course', 'Stansbury Park'], ['Sunbrook Golf Course', 'St. George'], ['SunRiver Golf Club', 'St. George'], ['TalonsCove Golf Club', 'Saratoga Springs'], ['Thanksgiving Point Golf Club', 'Lehi'], ['The Hideout', 'Monticello'], ['The Ledges of St. George', 'St. George'], ['The Links at Overlake', 'Tooele'], ['The Links at Sleepy Ridge', 'Orem'], ['The Ranches Golf Club', 'Eagle Mountain'], ['The Ridge Golf Course', 'West Valley City'], ['Thunderbird Golf Course', 'Cedar City'], ['University of Utah Golf Course', 'Salt Lake City'], ['Valley View Golf Course', 'Layton'], ['Wasatch Mountain (Lake)', 'Midway'], ['Wasatch Mountain (Mountain)', 'Midway'], ['Willow Creek Country Club', 'Sandy'], ['Wingpointe Golf Course', 'Salt Lake City'], ['Wolf Creek Golf Resort', 'Eden'],
]

const UT_OVERRIDES = {
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

const details = new Map()
for (const [name, city] of utahCourses) {
  const point = CITY_COORDINATES_UT[city]
  const override = UT_OVERRIDES[name] || {}
  details.set(`UT::${name.toLowerCase()}`, {
    name,
    state: 'UT',
    city,
    latitude: point?.latitude,
    longitude: point?.longitude,
    par: override.par || 72,
    courseRating: override.courseRating || 72,
    slopeRating: override.slopeRating || 113,
  })
}

export function getCourseDetails(state, courseName) {
  const key = `${String(state || '').toUpperCase()}::${String(courseName || '').toLowerCase()}`
  const detail = details.get(key)
  if (detail) return detail
  const name = String(courseName || '').trim()
  if (!name) return null
  return {
    name,
    state: String(state || '').toUpperCase(),
    par: 72,
    courseRating: 72,
    slopeRating: 113,
  }
}

export function calculateHandicapDifferential(score, courseRating, slopeRating) {
  const scoreNumber = Number(score)
  const ratingNumber = Number(courseRating)
  const slopeNumber = Number(slopeRating)
  if (!Number.isFinite(scoreNumber) || !Number.isFinite(ratingNumber) || !Number.isFinite(slopeNumber) || slopeNumber <= 0) return null
  return Math.round((((scoreNumber - ratingNumber) * 113) / slopeNumber) * 10) / 10
}
