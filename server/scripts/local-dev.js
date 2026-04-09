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
  PORT: '5001',
  CLIENT_PORT: '5174',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_NAME: 'golf_homiez',
  DB_USER: 'golf_homiez_user',
  DB_PASSWORD: 'change_me',
  CLIENT_ORIGIN: 'http://127.0.0.1:5174',
  DEV_CLIENT_ORIGIN: 'http://127.0.0.1:5174',
  PUBLIC_SERVER_ORIGIN: 'http://127.0.0.1:5001',
  BETTER_AUTH_URL: 'http://127.0.0.1:5001',
  BETTER_AUTH_SECRET: 'dev-only-secret-change-me-1234567890123456',
  VITE_AUTH_BASE_URL: 'http://127.0.0.1:5001/api/auth',
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf8')
  const parsed = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    parsed[key] = value
  }
  return parsed
}

const existingEnv = readEnvFile(envPath)
const resolvedPort = process.env.PORT || existingEnv.PORT || defaultEnv.PORT
const resolvedClientPort = process.env.CLIENT_PORT || existingEnv.CLIENT_PORT || defaultEnv.CLIENT_PORT

const derivedEnv = {
  ...defaultEnv,
  PORT: resolvedPort,
  CLIENT_PORT: resolvedClientPort,
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || existingEnv.CLIENT_ORIGIN || `http://127.0.0.1:${resolvedClientPort}`,
  DEV_CLIENT_ORIGIN: process.env.DEV_CLIENT_ORIGIN || existingEnv.DEV_CLIENT_ORIGIN || `http://127.0.0.1:${resolvedClientPort}`,
  PUBLIC_SERVER_ORIGIN: process.env.PUBLIC_SERVER_ORIGIN || existingEnv.PUBLIC_SERVER_ORIGIN || `http://127.0.0.1:${resolvedPort}`,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || existingEnv.BETTER_AUTH_URL || `http://127.0.0.1:${resolvedPort}`,
  VITE_AUTH_BASE_URL:
    process.env.VITE_AUTH_BASE_URL ||
    existingEnv.VITE_AUTH_BASE_URL ||
    `http://127.0.0.1:${resolvedPort}/api/auth`,
}

const mergedEnv = {
  ...existingEnv,
  ...Object.fromEntries(Object.entries(derivedEnv).filter(([, value]) => value != null && value !== '')),
}

const envLines = Object.entries(mergedEnv).map(([key, value]) => `${key}=${value}`)
fs.writeFileSync(envPath, `${envLines.join('\n')}\n`, 'utf8')

for (const [key, value] of Object.entries(mergedEnv)) {
  if (!process.env[key] && value) process.env[key] = value
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      cwd: rootDir,
      env: process.env,
      ...opts,
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

await run('docker', ['compose', 'up', '-d', 'mysql'])
await run('node', ['server/scripts/wait-for-db.js'])

const server = spawn('npm', ['run', 'dev:server'], {
  stdio: 'inherit',
  shell: true,
  cwd: rootDir,
  env: process.env,
})

const client = spawn('npm', ['run', 'dev:client', '--', '--host', '127.0.0.1', '--port', process.env.CLIENT_PORT], {
  stdio: 'inherit',
  shell: true,
  cwd: rootDir,
  env: process.env,
})

const shutdown = () => {
  server.kill('SIGINT')
  client.kill('SIGINT')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await Promise.race([
  new Promise((resolve, reject) =>
    server.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`dev:server exited with code ${code}`)))),
  ),
  new Promise((resolve, reject) =>
    client.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`dev:client exited with code ${code}`)))),
  ),
])
