import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '../..')
const envPath = path.join(rootDir, '.env')

const defaultEnv = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_NAME: 'golf_homiez',
  DB_USER: 'golf_homiez_user',
  DB_PASSWORD: 'change_me',
  CLIENT_ORIGIN: 'http://127.0.0.1:5174',
  BETTER_AUTH_URL: 'http://127.0.0.1:5001',
  BETTER_AUTH_SECRET: 'dev-only-secret-change-me-1234567890123456',
  VITE_AUTH_BASE_URL: 'http://127.0.0.1:5001/api/auth',
}

if (!fs.existsSync(envPath)) {
  const lines = Object.entries(defaultEnv).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(envPath, `${lines.join('\n')}\n`)
}

Object.entries(defaultEnv).forEach(([k, v]) => {
  if (!process.env[k]) process.env[k] = v
})

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true, cwd: rootDir, ...opts })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

await run('docker', ['compose', 'up', '-d', 'mysql'])
await run('node', ['server/scripts/wait-for-db.js'], { env: process.env })
await run('node', ['server/scripts/reset-session-logs.js'], { env: process.env })
const server = spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell: true, cwd: rootDir, env: process.env })
const client = spawn('npm', ['run', 'dev:client'], { stdio: 'inherit', shell: true, cwd: rootDir, env: process.env })

const shutdown = () => {
  server.kill('SIGINT')
  client.kill('SIGINT')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await Promise.race([
  new Promise((resolve, reject) => server.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`dev:server exited with code ${code}`)))),
  new Promise((resolve, reject) => client.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`dev:client exited with code ${code}`)))),
])
