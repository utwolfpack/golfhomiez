import { spawnSync } from 'child_process'

const result = spawnSync('docker', ['compose', 'up', '-d', 'mysql'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error || result.status !== 0) {
  console.error('Failed to start local MySQL container')
  if (result.error) console.error(result.error.message)
  process.exit(result.status || 1)
}

console.log('Local MySQL container is up.')
