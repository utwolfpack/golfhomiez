import fs from 'node:fs/promises'

export async function tableExists(db, tableName) {
  const [rows] = await db.execute(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1`,
    [tableName]
  )
  return rows.length > 0
}

export async function columnExists(db, tableName, columnName) {
  const [rows] = await db.execute(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  )
  return rows.length > 0
}

export async function indexExists(db, tableName, indexName) {
  const [rows] = await db.execute(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    [tableName, indexName]
  )
  return rows.length > 0
}

export async function foreignKeyExists(db, tableName, constraintName) {
  const [rows] = await db.execute(
    `SELECT 1
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name = ?
        AND constraint_name = ?
      LIMIT 1`,
    [tableName, constraintName]
  )
  return rows.length > 0
}

export async function loadSqlFile(filePath) {
  return fs.readFile(filePath, 'utf8')
}
