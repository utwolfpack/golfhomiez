import 'dotenv/config'
import { randomUUID } from 'crypto'
import { getPool, initDb, closeDb } from '../db.js'

const DEMO_EMAIL = 'thegolfhomie@example.com'
const DEMO_NAME = 'The Golf Homie'
const DEMO_USERNAME = 'the-golf-homie'
const DEMO_TEAM = 'Homie Hustlers'

const sampleRounds = [
  { mode: 'solo', date: '2026-03-21', state: 'UT', course: 'Bonneville Golf Course', roundScore: 82 },
  { mode: 'team', date: '2026-03-20', state: 'UT', course: 'Wasatch Mountain (Lake)', team: DEMO_TEAM, opponentTeam: 'Fairway Friends', teamTotal: 61, opponentTotal: 64, money: 3, won: 1 },
  { mode: 'solo', date: '2026-03-18', state: 'UT', course: 'Soldier Hollow (Silver)', roundScore: 85 },
  { mode: 'team', date: '2026-03-16', state: 'UT', course: 'Sand Hollow Golf Course', team: DEMO_TEAM, opponentTeam: 'Birdie Club', teamTotal: 63, opponentTotal: 62, money: -1, won: 0 },
  { mode: 'solo', date: '2026-03-14', state: 'UT', course: 'Bonneville Golf Course', roundScore: 80 },
  { mode: 'team', date: '2026-03-12', state: 'UT', course: 'Sunbrook Golf Course', team: DEMO_TEAM, opponentTeam: 'Course Crushers', teamTotal: 60, opponentTotal: 60, money: 0, won: null },
  { mode: 'solo', date: '2026-03-10', state: 'UT', course: 'Soldier Hollow (Gold)', roundScore: 87 },
  { mode: 'team', date: '2026-03-09', state: 'UT', course: 'Bonneville Golf Course', team: DEMO_TEAM, opponentTeam: 'Weekend Wagglers', teamTotal: 59, opponentTotal: 63, money: 4, won: 1 },
  { mode: 'solo', date: '2026-03-06', state: 'UT', course: 'Wasatch Mountain (Lake)', roundScore: 84 },
  { mode: 'team', date: '2026-03-05', state: 'UT', course: 'Sunbrook Golf Course', team: DEMO_TEAM, opponentTeam: 'Back Nine Bandits', teamTotal: 58, opponentTotal: 61, money: 5, won: 1 },
]

function buildHoleScores(total, holes = 18, par = 4) {
  const values = new Array(holes).fill(par)
  let delta = total - (holes * par)
  let i = 0
  while (delta !== 0 && i < 5000) {
    const idx = i % holes
    if (delta > 0 && values[idx] < 8) {
      values[idx] += 1
      delta -= 1
    } else if (delta < 0 && values[idx] > 2) {
      values[idx] -= 1
      delta += 1
    }
    i += 1
  }
  return values
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
  const updates = updateColumns.length
    ? updateColumns.map((column) => `${column} = VALUES(${column})`).join(', ')
    : `${columns[0]} = ${columns[0]}`
  return `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`
}

async function ensureDemoUser(conn) {
  const [rows] = await conn.execute('SELECT id FROM user WHERE LOWER(email) = LOWER(?) LIMIT 1', [DEMO_EMAIL])
  if (rows[0]?.id) return rows[0].id

  const columns = await getTableColumns(conn, 'user')
  const now = new Date()
  const payload = {
    id: randomUUID(),
    name: DEMO_NAME,
    email: DEMO_EMAIL,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    username: DEMO_USERNAME,
    displayUsername: DEMO_USERNAME,
  }
  const insertableColumns = Object.keys(payload).filter((column) => columns.has(column))
  const updateColumns = ['name', 'email', 'emailVerified', 'image', 'updatedAt', 'username', 'displayUsername']
    .filter((column) => insertableColumns.includes(column))
  await conn.execute(
    buildInsertStatement('user', insertableColumns, updateColumns),
    insertableColumns.map((column) => payload[column])
  )
  return payload.id
}

async function ensureDemoTeam(conn) {
  await conn.execute(
    `INSERT INTO teams (id, name, created_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [randomUUID(), DEMO_TEAM]
  )
  const [teams] = await conn.execute('SELECT id FROM teams WHERE name = ? LIMIT 1', [DEMO_TEAM])
  const teamId = teams[0]?.id
  await conn.execute('DELETE FROM team_members WHERE team_id = ?', [teamId])
  await conn.execute(
    'INSERT INTO team_members (id, team_id, name, email) VALUES (?, ?, ?, ?)',
    [randomUUID(), teamId, DEMO_NAME, DEMO_EMAIL]
  )
  return teamId
}

async function seedRounds(conn, userId) {
  await conn.execute('DELETE FROM scores WHERE created_by_email = ?', [DEMO_EMAIL])

  for (const round of sampleRounds) {
    if (round.mode === 'solo') {
      await conn.execute(
        `INSERT INTO scores (
          id, mode, date, state, course, round_score, holes_json, created_by_user_id, created_by_email, created_at
        ) VALUES (?, 'solo', ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [randomUUID(), round.date, round.state, round.course, round.roundScore, JSON.stringify(buildHoleScores(round.roundScore)), userId, DEMO_EMAIL]
      )
      continue
    }

    await conn.execute(
      `INSERT INTO scores (
        id, mode, date, state, course, team, opponent_team, team_total, opponent_total, money, won,
        holes_json, created_by_user_id, created_by_email, created_at
      ) VALUES (?, 'team', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        randomUUID(),
        round.date,
        round.state,
        round.course,
        round.team,
        round.opponentTeam,
        round.teamTotal,
        round.opponentTotal,
        round.money,
        round.won,
        JSON.stringify(buildHoleScores(round.teamTotal)),
        userId,
        DEMO_EMAIL,
      ]
    )
  }
}

async function main() {
  await initDb()
  const db = getPool()
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const userId = await ensureDemoUser(conn)
    await ensureDemoTeam(conn)
    await seedRounds(conn, userId)
    await conn.commit()
    console.log(`Seeded homepage demo data for ${DEMO_EMAIL}`)
  } catch (error) {
    await conn.rollback()
    console.error('Homepage demo seed failed:', error)
    process.exitCode = 1
  } finally {
    conn.release()
    await closeDb()
  }
}

main()
