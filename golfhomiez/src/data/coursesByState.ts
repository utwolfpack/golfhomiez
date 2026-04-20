import { UTAH_GOLF_COURSE_NAMES } from './utahCourses'

/**
 * Starter, offline-friendly course lists by state.
 * Utah is fully populated from our existing UT list.
 * Other states include a handful of well-known options and can be expanded any time.
 */
const COURSES_BY_STATE: Record<string, string[]> = {
  UT: UTAH_GOLF_COURSE_NAMES,
  AZ: ['TPC Scottsdale', 'We-Ko-Pa Golf Club', 'Boulders Golf Club', 'Grayhawk Golf Club', 'Troon North Golf Club'],
  CA: ['Pebble Beach Golf Links', 'Torrey Pines (South)', 'TPC Harding Park', 'Pasatiempo', 'PGA West (Stadium)'],
  CO: ['Arrowhead Golf Club', 'The Broadmoor (East)', 'Fossil Trace', 'TPC Colorado', 'Red Sky Ranch'],
  FL: ['TPC Sawgrass', 'Streamsong (Red)', 'Bay Hill Club & Lodge', 'PGA National (Champion)', 'Trump Doral (Blue Monster)'],
  GA: ['Augusta National (private)', 'Sea Island (Seaside)', 'TPC Sugarloaf', 'East Lake Golf Club', 'The Highlands at Atlanta Athletic Club (private)'],
  HI: ['Kapalua (Plantation)', 'Waialae Country Club (private)', 'Ko Olina Golf Club', 'Princeville Makai', 'Mauna Kea Golf Course'],
  ID: ['Circling Raven', 'Coeur d’Alene Resort Golf Course', 'Jug Mountain Ranch', 'BanBury Golf Course', 'Falcon Crest Golf Course'],
  IL: ['Cog Hill (Dubsdread)', 'Medinah (private)', 'Harborside International', 'TPC Deere Run', 'Cantigny Golf'],
  IN: ['Pete Dye Course at French Lick', 'Victoria National (private)', 'Prairie View Golf Club', 'The Fort Golf Resort', 'Brickyard Crossing'],
  KS: ['Colbert Hills', 'Prairie Dunes (private)', 'Firekeeper Golf Course', 'Sand Creek Station', 'Falcon Lakes Golf Club'],
  MA: ['TPC Boston (private)', 'The Country Club (private)', 'Crumpin-Fox', 'Granite Links', 'Waverly Oaks'],
  MI: ['Arcadia Bluffs', 'Forest Dunes', 'Treetops (Threetops)', 'The Loop at Forest Dunes', 'Bay Harbor Golf Club'],
  MN: ['Hazeltine National (private)', 'Interlachen (private)', 'The Classic at Maddens', 'Deacon’s Lodge', 'Giants Ridge (Legend)'],
  MO: ['Buffalo Ridge Springs', 'Payne’s Valley', 'Bellerive (private)', 'Branson Hills', 'Old Warson (private)'],
  MT: ['Old Works', 'Wilderness Club', 'Big Sky Golf Course', 'Pomps Club', 'Spanish Peaks (private)'],
  NC: ['Pinehurst No. 2', 'Pine Needles', 'Mid Pines', 'Quail Hollow', 'Tobacco Road'],
  NV: ['Shadow Creek (private)', 'TPC Las Vegas', 'Bali Hai', 'Paiute (Wolf)', 'Cascata'],
  NY: ['Bethpage Black', 'Winged Foot (private)', 'Shinnecock Hills (private)', 'Montauk Downs', 'Turning Stone (Atunyote)'],
  OH: ['Muirfield Village (private)', 'Firestone (South)', 'The Virtues Golf Club', 'Manakiki', 'The Golf Club (private)'],
  OR: ['Bandon Dunes', 'Pacific Dunes', 'Pronghorn', 'Pumpkin Ridge', 'Chambers Bay (nearby WA option)'],
  PA: ['Oakmont (private)', 'Merion (private)', 'Aronimink (private)', 'Nemacolin (Mystic Rock)', 'Pine Creek Golf Club'],
  SC: ['Harbour Town', 'Kiawah Island (Ocean)', 'Caledonia Golf & Fish Club', 'True Blue', 'The Dunes Golf & Beach Club'],
  TN: ['Sweetens Cove', 'The Honors Course (private)', 'TPC Southwind', 'Hermitage (President’s Reserve)', 'Bear Trace at Harrison Bay'],
  TX: ['PGA Frisco (Fields Ranch)', 'TPC San Antonio', 'Austin Country Club (private)', 'Omni Barton Creek', 'The Woodlands (Tournament)'],
  VA: ['Primland (Highlands)', 'Kingsmill (River)', 'The Homestead (Cascades)', 'Robert Trent Jones GC', 'Independence Golf Club'],
  WA: ['Chambers Bay', 'Gamble Sands', 'Gold Mountain (Olympic)', 'The Home Course', 'Wine Valley Golf Club'],
  WI: ['Whistling Straits', 'Erin Hills', 'Sand Valley', 'Mammoth Dunes', 'Blackwolf Run (River)'],
}

export function getCoursesForState(stateAbbr: string): string[] {
  const key = (stateAbbr || '').toUpperCase()
  const list = COURSES_BY_STATE[key] || []
  // de-dupe + sort, keep stable
  return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b))
}

/**
 * Union of all seeded courses across states (offline list).
 * Useful when the user selects "All states".
 */
export function getAllSeededCourses(): string[] {
  const all = Object.values(COURSES_BY_STATE).flat()
  return Array.from(new Set(all)).sort((a, b) => a.localeCompare(b))
}
