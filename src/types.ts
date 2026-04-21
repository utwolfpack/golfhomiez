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
  money: number // + won, - lost
  won: true | false | null // null = tie
  holes: number[] | null
  golfCourseId?: string | null
  courseRating?: number | null
  slopeRating?: number | null
  coursePar?: number | null
  createdByUserId?: string
  createdByEmail?: string
  createdAt: string
}

export type SoloScoreEntry = {
  id: string
  mode: 'solo'
  date: string // YYYY-MM-DD
  state: string
  course: string
  roundScore: number
  holes: number[] | null
  golfCourseId?: string | null
  courseRating?: number | null
  slopeRating?: number | null
  coursePar?: number | null
  createdByUserId?: string
  createdByEmail?: string
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

export type Team = {
  id: string
  name: string
  members: TeamMember[]
  createdAt: string
  hasPendingMembers?: boolean
}
