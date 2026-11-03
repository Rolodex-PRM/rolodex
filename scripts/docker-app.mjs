import { spawn } from 'node:child_process'

function start(args) {
  return spawn('pnpm', args, { stdio: 'inherit' })
}

const migrate = start(['--filter', '@rolodex/db', 'migrate'])
migrate.on('exit', (code, signal) => {
  if (signal || code) process.exit(code || 1)
  const children = [start(['--filter', '@rolodex/api', 'start']), start(['--filter', '@rolodex/carddav', 'start'])]
  let stopping = false
  const stop = (status) => {
    if (stopping) return
    stopping = true
    for (const child of children) child.kill('SIGTERM')
    setTimeout(() => process.exit(status), 500)
  }
  process.on('SIGTERM', () => stop(0))
  process.on('SIGINT', () => stop(0))
  for (const child of children) {
    child.on('exit', (childCode, childSignal) => {
      if (stopping) return
      stop(childSignal ? 1 : (childCode ?? 1))
    })
  }
})
