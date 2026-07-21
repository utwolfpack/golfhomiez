export type HoleScoreDetail = {
  hole: number
  par: number | null
  yards: number | null
  strokeIndex: number | null
  teeColor?: 'red' | 'white' | 'blue' | 'black' | string | null
  teeBoxType?: string | null
  distanceToFrontYards?: number | null
  distanceToCenterYards?: number | null
  distanceToBackYards?: number | null
  distanceToFlagYards?: number | null
  frontLatitude?: number | null
  frontLongitude?: number | null
  centerLatitude?: number | null
  centerLongitude?: number | null
  backLatitude?: number | null
  backLongitude?: number | null
  flagLatitude?: number | null
  flagLongitude?: number | null
  score: number | null
  scoreProvided?: boolean
}

export type HoleScores = number[] | HoleScoreDetail[]

export type ScoreRecordSource = 'score' | 'team_challenge'

export type TeamScoreEntry = {
  id: string
  mode: 'team'
  date: string // YYYY-MM-DD
  state: string
  course: string
  team: string
  opponentTeam: string
  teamTotal: number
  opponentTotal: number
  won: true | false | null // null = tie
  holes: HoleScores | null
  opponentHoles?: HoleScores | null
  golfCourseId?: string | null
  courseRating?: number | null
  slopeRating?: number | null
  coursePar?: number | null
  teeColor?: 'red' | 'white' | 'blue' | 'black' | string | null
  createdByUserId?: string
  createdByEmail?: string
  source?: ScoreRecordSource
  sourceMessageId?: string | null
  challengeStatus?: string | null
  challengeScoringType?: string | null
  challengePointsPerHole?: number | string | null
  createdAt: string
}

export type SoloScoreEntry = {
  id: string
  mode: 'solo'
  date: string // YYYY-MM-DD
  state: string
  course: string
  roundScore: number
  holes: HoleScores | null
  opponentHoles?: HoleScores | null
  golfCourseId?: string | null
  courseRating?: number | null
  slopeRating?: number | null
  coursePar?: number | null
  teeColor?: 'red' | 'white' | 'blue' | 'black' | string | null
  createdByUserId?: string
  createdByEmail?: string
  source?: ScoreRecordSource
  createdAt: string
}

export type ScoreEntry = TeamScoreEntry | SoloScoreEntry

export type TeamMemberStatus = 'active' | 'pending_verification' | 'invited'

export type TeamMember = {
  id: string
  name: string
  email: string
  status?: TeamMemberStatus
  verified?: boolean
}

export type TeamStatus = 'pending' | 'verified'

export type Team = {
  id: string
  name: string
  members: TeamMember[]
  createdAt: string
  status?: TeamStatus
  hasPendingMembers?: boolean
}
