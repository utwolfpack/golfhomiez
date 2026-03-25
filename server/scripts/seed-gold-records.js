import 'dotenv/config'
import { randomUUID } from 'crypto'
import { getPool, initDb, closeDb } from '../db.js'

const TEAM_COUNT = 50
const ROUNDS_PER_MODE = 50
const DEMO_TAG = '[demo-seed]'
const PASSWORD_HASH_PLACEHOLDER = '$2b$12$replace-this-with-a-real-bcrypt-hash-before-logging-in'

const firstNames = ['Alex', 'Jordan', 'Taylor', 'Cameron', 'Parker', 'Quinn', 'Riley', 'Dakota', 'Morgan', 'Casey']
const lastNames = ['Brooks', 'Carter', 'Hayes', 'Turner', 'Cooper', 'Reed', 'Bailey', 'Foster', 'Perry', 'Bennett']
const states = ['AZ', 'CA', 'CO', 'FL', 'GA', 'NV', 'TX', 'UT']
const courses = [
  'Pebble Ridge', 'Juniper Hills', 'Silver Lake', 'Red Rock Dunes', 'Pine Valley West',
  'Canyon Creek', 'Wasatch Greens', 'Eagle Crest', 'Palm Vista', 'Blue Mesa Golf Club'
]

function pick(list, index) {
  return list[index % list.length]
}

function userRecord(index) {
  const firstName = pick(firstNames, index)
  const lastName = pick(lastNames, Math.floor(index / firstNames.length))
  const handle = `${firstName}.${lastName}.${String(index + 1).padStart(2, '0')}`.toLowerCase()
  return {
    id: randomUUID(),
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    username: handle,
    email: `${handle}@example.com`,
    teamName: `Demo Team ${String(index + 1).padStart(2, '0')}`,
  }
}

function buildHoleScores(total, holes = 18) {
  const values = new Array(holes).fill(4)
  let delta = total - (holes * 4)
  let i = 0
  while (delta !== 0) {
    const idx = i % holes
    if (delta > 0 && values[idx] < 7) {
      values[idx] += 1
      delta -= 1
    } else if (delta < 0 && values[idx] > 3) {
      values[idx] -= 1
      delta += 1
    }
    i += 1
  }
  return values
}

function dateDaysAgo(daysAgo) {
  const dt = new Date()
  dt.setUTCDate(dt.getUTCDate() - daysAgo)
  return dt.toISOString().slice(0, 10)
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

async function upsertAuthUser(conn, user, userColumns, accountColumns) {
  const now = new Date()
  const userPayload = {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    username: user.username,
    displayUsername: user.username,
  }

  const insertableUserColumns = Object.keys(userPayload).filter((column) => userColumns.has(column))
  const userUpdateColumns = ['name', 'email', 'emailVerified', 'image', 'updatedAt', 'username', 'displayUsername']
    .filter((column) => insertableUserColumns.includes(column))

  await conn.execute(
    buildInsertStatement('user', insertableUserColumns, userUpdateColumns),
    insertableUserColumns.map((column) => userPayload[column])
  )

  const accountPayload = {
    id: randomUUID(),
    accountId: user.email,
    providerId: 'credential',
    userId: user.id,
    password: PASSWORD_HASH_PLACEHOLDER,
    createdAt: now,
    updatedAt: now,
  }

  const insertableAccountColumns = Object.keys(accountPayload).filter((column) => accountColumns.has(column))
  const accountUpdateColumns = ['userId', 'password', 'updatedAt'].filter((column) => insertableAccountColumns.includes(column))

  await conn.execute(
    buildInsertStatement('account', insertableAccountColumns, accountUpdateColumns),
    insertableAccountColumns.map((column) => accountPayload[column])
  )
}

async function upsertTeam(conn, user) {
  const teamId = randomUUID()
  const memberId = randomUUID()
  await conn.execute(
    `INSERT INTO teams (id, name, created_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [teamId, user.teamName]
  )

  const [[team]] = await conn.execute('SELECT id FROM teams WHERE name = ? LIMIT 1', [user.teamName])
  await conn.execute('DELETE FROM team_members WHERE team_id = ?', [team.id])
  await conn.execute(
    `INSERT INTO team_members (id, team_id, name, email) VALUES (?, ?, ?, ?)`,
    [memberId, team.id, user.name, user.email]
  )
  return team.id
}

async function insertScores(conn, demoUsers) {
  await conn.execute(`DELETE FROM scores WHERE created_by_email LIKE '%@example.com'`)

  for (let i = 0; i < ROUNDS_PER_MODE; i += 1) {
    const user = demoUsers[0]
    const roundScore = 72 + (i % 12)
    await conn.execute(
      `INSERT INTO scores (
        id, mode, date, state, course, round_score, holes_json, created_by_user_id, created_by_email, created_at
      ) VALUES (?, 'solo', ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        randomUUID(),
        dateDaysAgo(i),
        pick(states, i),
        `${pick(courses, i)} Solo ${DEMO_TAG}`,
        roundScore,
        JSON.stringify(buildHoleScores(roundScore)),
        user.id,
        user.email,
      ]
    )
  }

  for (let i = 0; i < ROUNDS_PER_MODE; i += 1) {
    const teamA = demoUsers[i % demoUsers.length]
    const teamB = demoUsers[(i + 1) % demoUsers.length]
    const teamTotal = 64 + (i % 8)
    const opponentTotal = 65 + ((i + 3) % 8)
    const won = teamTotal < opponentTotal ? 1 : teamTotal > opponentTotal ? 0 : null
    const money = won === 1 ? Math.abs(opponentTotal - teamTotal) : won === 0 ? -Math.abs(opponentTotal - teamTotal) : 0
    await conn.execute(
      `INSERT INTO scores (
        id, mode, date, state, course, team, opponent_team,
        team_total, opponent_total, money, won, holes_json,
        created_by_user_id, created_by_email, created_at
      ) VALUES (?, 'team', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        randomUUID(),
        dateDaysAgo(i),
        pick(states, i),
        `${pick(courses, i + 2)} Scramble ${DEMO_TAG}`,
        teamA.teamName,
        teamB.teamName,
        teamTotal,
        opponentTotal,
        money,
        won,
        JSON.stringify(buildHoleScores(teamTotal)),
        teamA.id,
        teamA.email,
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

    const userColumns = await getTableColumns(conn, 'user')
    const accountColumns = await getTableColumns(conn, 'account')
    const users = Array.from({ length: TEAM_COUNT }, (_, index) => userRecord(index))

    for (const user of users) {
      await upsertAuthUser(conn, user, userColumns, accountColumns)
      await upsertTeam(conn, user)
    }

    await insertScores(conn, users)
    await conn.commit()

    console.log(`Seeded ${TEAM_COUNT} demo users/teams and ${ROUNDS_PER_MODE} solo + ${ROUNDS_PER_MODE} team rounds.`)
    console.log('The seed script now adapts to your live Better Auth schema, including installs without username/displayUsername columns.')
    console.log('Demo credential note: account rows are created, but password hashes are placeholders.')
    console.log('Replace PASSWORD_HASH_PLACEHOLDER in server/scripts/seed-gold-records.js with a real bcrypt hash before using demo logins.')
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
    await closeDb()
  }
}

main().catch((error) => {
  console.error('Demo seed failed:', error)
  process.exit(1)
})
