export function getMySqlConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'golf_homiez_user',
    password: process.env.DB_PASSWORD || 'change_me',
    database: process.env.DB_NAME || 'golf_homiez',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || '10'),
    queueLimit: 0,
    multipleStatements: true,
    timezone: 'Z',
  }
}
