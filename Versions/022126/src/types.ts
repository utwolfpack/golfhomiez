export type ScoreEntry = {
  id: string
  date: string // YYYY-MM-DD
  course: string
  team: string
  opponentTeam: string
  teamTotal: number
  opponentTotal: number
  money: number // + won, - lost
  won: true | false | null // null = tie
  holes: number[] | null
  createdAt: string
}


export type TeamMember = {
  id: string
  name: string
  email: string
}

export type Team = {
  id: string
  name: string
  members: TeamMember[]
  createdAt: string
}
