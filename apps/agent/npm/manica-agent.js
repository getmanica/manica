#!/usr/bin/env node
// The `manica-agent` command of the @manica/agent npm package: runs the
// executable of the platform package the package manager installed next to
// it. Signals are forwarded, so a SIGTERM still lets running jobs finish.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const name = `@manica/agent-${process.platform}-${process.arch}`

let binary
try {
  binary = createRequire(import.meta.url).resolve(`${name}/bin/manica-agent`)
} catch {
  console.error(
    `manica-agent: ${name} is not installed. Either ${process.platform}-${process.arch} is not supported, or optional dependencies were skipped while installing @manica/agent.`,
  )
  process.exit(1)
}

const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal))
}
child.on('error', (error) => {
  console.error(`manica-agent: ${error.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal)
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 1)
  }
})
