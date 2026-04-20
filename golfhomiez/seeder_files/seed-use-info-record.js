import 'dotenv/config'
import { randomUUID } from 'crypto'
import { getPool, initDb, closeDb } from '../db.js'

const SOLO_ROUNDS = 80
const TEAM_ROUNDS = 40
const TEAM_COUNT = 6
const TEAM_SIZE = 4
const SEED_TAG = '[seed-user-info]'

const firstNames = ['Alex', 'Jordan', 'Taylor', 'Cameron', 'Parker', 'Quinn', 'Riley', 'Dakota', 'Morgan', 'Casey', 'Skyler', 'Avery']
const lastNames = ['Brooks', 'Carter', 'Hayes', 'Turner', 'Cooper', 'Reed', 'Bailey', 'Foster', 'Perry', 'Bennett', 'Powell', 'Walker']
const soloCoursePool = [
  { state: 'UT', course: 'Bonneville Golf Course' },
  { state: 'UT', course: 'Wasatch Mountain (Lake)' },
  { state: 'UT', course: 'Wasatch Mountain (Mountain)' },
  { state: 'UT', course: 'Soldier Hollow (Gold)' },
  { state: 'UT', course: 'The Ledges of St. George' },
  { state: 'UT', course: 'Sand Hollow Golf Course' },
  { state: 'AZ', course: 'TPC Scottsdale' },
  { state: 'CA', course: 'Pebble Beach Golf Links' },
  { state: 'CO', course: 'Arrowhead Golf Club' },
  { state: 'NV', course: 'Shadow Creek (private)' },
]
const scrambleCoursePool = [
  { state: 'UT', course: 'Sunbrook Golf Course' },
  { state: 'UT', course: 'Copper Rock Golf Course' },
  { state: 'UT', course: 'Black Desert Resort Golf Course' },
  { state: 'AZ', course: 'We-Ko-Pa Golf Club' },
  { state: 'CA', course: 'Torrey Pines (South)' },
  { state: 'CO', course: 'Fossil Trace' },
  { state: 'NC', course: 'Pinehurst No. 2' },
  { state: 'TX', course: 'PGA Frisco (Fields Ranch)' },
]

function usage() {
  console.log('Usage: node server/scripts/seed-use-info-record.js <user-email>')
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function pick(list, index) {
  return list[index % list.length]
}

function dateDaysAgo(daysAgo) {
  const dt = new Date()
  dt.setUTCDate(dt.getUTCDate() - daysAgo)
  return dt.toISOString().slice(0, 10)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function slugifyEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/@.*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'demo-player'
}

function titleCase(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ''
}

function deriveDisplayName(email) {
  const local = String(email || '').split('@')[0] || ''
  const bits = local.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (bits.length === 0) return 'Demo Player'
  return bits.slice(0, 3).map(titleCase).join(' ')
}

function buildHoleScores(total, holes = 18, baseScore = 4) {
  const minPerHole = 2
  const maxPerHole = 8
  const values = new Array(holes).fill(baseScore)
  let delta = total - (holes * baseScore)
  let i = 0

  while (delta !== 0 && i < 10000) {
    const idx = i % holes
    if (delta > 0 && values[idx] < maxPerHole) {
      values[idx] += 1
      delta -= 1
    } else if (delta < 0 && values[idx] > minPerHole) {
      values[idx] -= 1
      delta += 1
    }
    i += 1
  }

  if (delta !== 0) {
    throw new Error(`Could not build hole scores for total ${total}`)
  }

  return values
}

function buildTeamNames(targetEmail) {
  const slug = slugifyEmail(targetEmail)
  return Array.from({ length: TEAM_COUNT }, (_, index) => `Demo ${titleCase(slug.replace(/-/g, ' '))} Squad ${index + 1}`)
}

function buildOpponentName(targetEmail, index) {
  const slug = slugifyEmail(targetEmail)
  return `Rival ${titleCase(slug.replace(/-/g, ' '))} Flight ${(index % 8) + 1}`
}

function fakeMember(targetEmail, teamIndex, seatIndex) {
  const slug = slugifyEmail(targetEmail)
  const basis = (teamIndex * 3) + seatIndex
  const firstName = pick(firstNames, basis + 2)
  const lastName = pick(lastNames, basis + 5)
  const handle = `${slug}.t${teamIndex + 1}m${seatIndex + 1}`
  return {
    id: randomUUID(),
    name: `${firstName} ${lastName}`,
    email: `${handle}@example.com`,
  }
}

async function getTableColumns(conn, tableName) {
  const [rows] = await conn.execute(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  )
  return new Set(rows.map((row) => row.COLUMN_NAME))
}

function buildInsertStatement(tableName, columns, updateColumns) {
  const columnList = columns.join(', ')
  const placeholders = columns.map(() => '?').join(', ')
  const updates = updateColumns.length > 0
    ? updateColumns.map((column) => `${column} = VALUES(${column})`).join(', ')
    : `${columns[0]} = ${columns[0]}`

  return `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`
}

async function ensureTargetUser(conn, email, userColumns) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const [rows] = await conn.execute(
    `SELECT id, name, email
       FROM user
      WHERE LOWER(email) = LOWER(?)
      LIMIT 1`,
    [normalizedEmail]
  )

  if (rows[0]) {
    return {
      id: rows[0].id,
      name: rows[0].name || deriveDisplayName(normalizedEmail),
      email: rows[0].email || normalizedEmail,
      created: false,
    }
  }

  const now = new Date()
  const displayName = deriveDisplayName(normalizedEmail)
  const username = slugifyEmail(normalizedEmail)
  const payload = {
    id: randomUUID(),
    name: displayName,
    email: normalizedEmail,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    username,
    displayUsername: username,
  }

  const insertableColumns = Object.keys(payload).filter((column) => userColumns.has(column))
  const updateColumns = ['name', 'email', 'emailVerified', 'image', 'updatedAt', 'username', 'displayUsername']
    .filter((column) => insertableColumns.includes(column))

  await conn.execute(
    buildInsertStatement('user', insertableColumns, updateColumns),
    insertableColumns.map((column) => payload[column])
  )

  return {
    id: payload.id,
    name: payload.name,
    email: payload.email,
    created: true,
  }
}

async function upsertTeamWithRoster(conn, teamName, targetUser, teamIndex) {
  const teamIdCandidate = randomUUID()
  await conn.execute(
    `INSERT INTO teams (id, name, created_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [teamIdCandidate, teamName]
  )

  const [rows] = await conn.execute('SELECT id FROM teams WHERE name = ? LIMIT 1', [teamName])
  const teamId = rows[0]?.id
  if (!teamId) throw new Error(`Could not locate team ${teamName}`)

  await conn.execute('DELETE FROM team_members WHERE team_id = ?', [teamId])

  const roster = [
    { id: randomUUID(), name: targetUser.name, email: targetUser.email },
    fakeMember(targetUser.email, teamIndex, 0),
    fakeMember(targetUser.email, teamIndex, 1),
    fakeMember(targetUser.email, teamIndex, 2),
  ].slice(0, TEAM_SIZE)

  for (const member of roster) {
    await conn.execute(
      'INSERT INTO team_members (id, team_id, name, email) VALUES (?, ?, ?, ?)',
      [member.id, teamId, member.name, member.email]
    )
  }

  return { id: teamId, name: teamName, roster }
}

async function deletePriorSeededScores(conn, targetUser) {
  const seededCourses = Array.from(new Set([...soloCoursePool, ...scrambleCoursePool].map((entry) => entry.course)))
  const coursePlaceholders = seededCourses.map(() => '?').join(', ')
  await conn.execute(
    `DELETE FROM scores
      WHERE created_by_email = ?
        AND (
          course LIKE ?
          OR course IN (${coursePlaceholders})
          OR team LIKE ?
          OR opponent_team LIKE ?
        )`,
    [
      targetUser.email,
      `%${SEED_TAG}%`,
      ...seededCourses,
      `Demo %`,
      `Rival %`,
    ]
  )
}

async function seedSoloRounds(conn, targetUser) {
  for (let i = 0; i < SOLO_ROUNDS; i += 1) {
    const round = pick(soloCoursePool, i)
    const roundScore = clamp(79 + (i % 7) + (Math.floor(i / 10) % 3), 74, 92)
    await conn.execute(
      `INSERT INTO scores (
        id, mode, date, state, course, round_score, holes_json,
        created_by_user_id, created_by_email, created_at
      ) VALUES (?, 'solo', ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        randomUUID(),
        dateDaysAgo(i + 1),
        round.state,
        round.course,
        roundScore,
        JSON.stringify(buildHoleScores(roundScore, 18, 4)),
        targetUser.id,
        targetUser.email,
      ]
    )
  }
}

async function seedTeamRounds(conn, targetUser, teams) {
  for (let i = 0; i < TEAM_ROUNDS; i += 1) {
    const team = teams[i % teams.length]
    const round = pick(scrambleCoursePool, i)
    const teamTotal = 60 + (i % 8)
    const opponentTotal = 61 + ((i + 3) % 9)
    const won = teamTotal < opponentTotal ? 1 : teamTotal > opponentTotal ? 0 : null
    const money = won === 1 ? Number((5 + (i % 4) * 5).toFixed(2)) : won === 0 ? Number((-(5 + (i % 4) * 5)).toFixed(2)) : 0

    await conn.execute(
      `INSERT INTO scores (
        id, mode, date, state, course, team, opponent_team,
        team_total, opponent_total, money, won, holes_json,
        created_by_user_id, created_by_email, created_at
      ) VALUES (?, 'team', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        randomUUID(),
        dateDaysAgo(i + 3),
        round.state,
        round.course,
        team.name,
        buildOpponentName(targetUser.email, i),
        teamTotal,
        opponentTotal,
        money,
        won,
        JSON.stringify(buildHoleScores(teamTotal, 18, 4)),
        targetUser.id,
        targetUser.email,
      ]
    )
  }
}

async function main() {
  const targetEmail = String(process.argv[2] || '').trim().toLowerCase()
  if (!targetEmail || !isEmail(targetEmail)) {
    usage()
    process.exit(1)
  }

  await initDb()
  const db = getPool()
  const conn = await db.getConnection()

  try {
    await conn.beginTransaction()

    const userColumns = await getTableColumns(conn, 'user')
    const targetUser = await ensureTargetUser(conn, targetEmail, userColumns)
    const teamNames = buildTeamNames(targetEmail)

    await deletePriorSeededScores(conn, targetUser)

    const teams = []
    for (let i = 0; i < teamNames.length; i += 1) {
      teams.push(await upsertTeamWithRoster(conn, teamNames[i], targetUser, i))
    }

    await seedSoloRounds(conn, targetUser)
    await seedTeamRounds(conn, targetUser, teams)

    await conn.commit()

    console.log(`Seed complete for ${targetUser.email}`)
    console.log(`- ${SOLO_ROUNDS} solo rounds created`)
    console.log(`- ${TEAM_ROUNDS} team rounds created`)
    console.log(`- ${TEAM_COUNT} team memberships refreshed`)
    console.log(`- user row ${targetUser.created ? 'created' : 'reused'}`)
    console.log('Teams:')
    for (const team of teams) {
      console.log(`  - ${team.name}`)
    }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
    await closeDb()
  }
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
