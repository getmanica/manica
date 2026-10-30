#!/usr/bin/env bun
import { join } from 'node:path'
import { parseCli, usage } from './cli'
import { defaultConfigDir, loadConfig } from './config'
import { AgentError, UsageError } from './errors'
import { reportExit, runLive } from './live'
import { createPlane } from './plane'
import { createInstaller } from './runner/install'
import { createSupervisor } from './runner/supervisor'
import { version } from './version'

const main = async () => {
  const cli = parseCli(Bun.argv.slice(2))
  if (cli.help) return console.log(usage)
  if (cli.version) return console.log(version)

  const config = await loadConfig(cli.configDir ?? defaultConfigDir())

  // The first SIGINT or SIGTERM lets running jobs finish; a second stops
  // them.
  const drain = new AbortController()
  const stop = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (!drain.signal.aborted) {
        console.log(
          'shutting down once running jobs finish; signal again to stop them',
        )
        drain.abort()
      } else if (!stop.signal.aborted) {
        console.log('stopping running jobs')
        stop.abort()
      }
    })
  }

  const plane = createPlane(config.plane)
  const supervisor = createSupervisor({
    runnersDir: join(config.dataDir, 'runners'),
    installer: createInstaller(join(config.dataDir, 'builds')),
    report: reportExit(plane),
  })
  await runLive(config, plane, supervisor, {
    drain: drain.signal,
    stop: stop.signal,
  })
}

try {
  await main()
} catch (error) {
  if (!(error instanceof AgentError)) throw error
  console.error(`error: ${error.message}`)
  if (error instanceof UsageError) console.error(`\n${usage}`)
  process.exit(error instanceof UsageError ? 2 : 1)
}
