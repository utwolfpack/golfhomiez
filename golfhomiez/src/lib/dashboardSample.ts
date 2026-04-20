import type { ScoreEntry } from '../types'

const now = new Date().toISOString()

export const GUEST_HOME_NAME = 'the Golf Homie'
export const GUEST_HOME_EMAIL = 'thegolfhomie@example.com'

export const GUEST_HOME_SCORES: ScoreEntry[] = [
  { id: 'guest-solo-1', mode: 'solo', date: '2026-03-21', state: 'UT', course: 'Bonneville Golf Course', roundScore: 82, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now, courseRating: 70.8, slopeRating: 127 } as any,
  { id: 'guest-team-1', mode: 'team', date: '2026-03-20', state: 'UT', course: 'Wasatch Mountain (Lake)', team: 'Homie Hustlers', opponentTeam: 'Fairway Friends', teamTotal: 61, opponentTotal: 64, money: 3, won: true, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now } as any,
  { id: 'guest-solo-2', mode: 'solo', date: '2026-03-18', state: 'UT', course: 'Soldier Hollow (Silver)', roundScore: 85, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now, courseRating: 71.9, slopeRating: 126 } as any,
  { id: 'guest-team-2', mode: 'team', date: '2026-03-16', state: 'UT', course: 'Sand Hollow Golf Course', team: 'Homie Hustlers', opponentTeam: 'Birdie Club', teamTotal: 63, opponentTotal: 62, money: -1, won: false, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now } as any,
  { id: 'guest-solo-3', mode: 'solo', date: '2026-03-14', state: 'UT', course: 'Bonneville Golf Course', roundScore: 80, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now, courseRating: 70.8, slopeRating: 127 } as any,
  { id: 'guest-team-3', mode: 'team', date: '2026-03-12', state: 'UT', course: 'Sunbrook Golf Course', team: 'Homie Hustlers', opponentTeam: 'Course Crushers', teamTotal: 60, opponentTotal: 60, money: 0, won: null, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now } as any,
  { id: 'guest-solo-4', mode: 'solo', date: '2026-03-10', state: 'UT', course: 'Soldier Hollow (Gold)', roundScore: 87, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now, courseRating: 73.8, slopeRating: 134 } as any,
  { id: 'guest-team-4', mode: 'team', date: '2026-03-09', state: 'UT', course: 'Bonneville Golf Course', team: 'Homie Hustlers', opponentTeam: 'Weekend Wagglers', teamTotal: 59, opponentTotal: 63, money: 4, won: true, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now } as any,
  { id: 'guest-solo-5', mode: 'solo', date: '2026-03-06', state: 'UT', course: 'Wasatch Mountain (Lake)', roundScore: 84, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now, courseRating: 72.5, slopeRating: 129 } as any,
  { id: 'guest-team-5', mode: 'team', date: '2026-03-05', state: 'UT', course: 'Sunbrook Golf Course', team: 'Homie Hustlers', opponentTeam: 'Back Nine Bandits', teamTotal: 58, opponentTotal: 61, money: 5, won: true, holes: null, createdByEmail: GUEST_HOME_EMAIL, createdAt: now } as any,
]
