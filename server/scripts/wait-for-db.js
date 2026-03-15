import mysql from 'mysql2/promise'

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'golf_homiez_user',
  password: process.env.DB_PASSWORD || 'change_me',
  database: process.env.DB_NAME || 'golf_homiez',
}

const maxAttempts = 40
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    const conn = await mysql.createConnection(config)
    await conn.query('SELECT 1')
    await conn.end()
    console.log('MySQL is ready.')
    process.exit(0)
  } catch (error) {
    if (attempt === maxAttempts) {
      console.error('MySQL did not become ready in time.')
      console.error(error)
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}
