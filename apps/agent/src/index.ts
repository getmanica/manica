#!/usr/bin/env bun
import { join } from 'node:path'
import { parseCli, usage } from './cli'
import { type Config, defaultConfigDir, loadConfig } from './config'
import { diagnose, formatSections, healthy } from './doctor'
import { AgentError, UsageError } from './errors'
import { reportExit, runLive } from './live'
import { createSampler } from './metrics'
import { createPlane } from './plane'
import { createLocalHost } from './runner/host'
import { createInstaller } from './runner/install'
import { createSupervisor } from './runner/supervisor'
import { createVmHost } from './runner/vm-host'
import { version } from './version'
import { BACKENDS } from './vm/backends'

// Where jobs run: in VMs if `[vm]` is set, checked up front so the agent
// doesn't take jobs it would only fail; otherwise on this machine.
const createHost = async (config: Config) => {
  const installer = createInstaller(join(config.dataDir, 'builds'))
  if (!config.vm) {
    return createLocalHost({
      runnersDir: join(config.dataDir, 'runners'),
      installer,
    })
  }
  const host = createVmHost({
    backend: BACKENDS[config.vm.backend](),
    image: config.vm.image,
    installer,
  })
  await host.check()
  return host
}

const main = async () => {
  const cli = parseCli(Bun.argv.slice(2))
  if (cli.help) return console.log(usage)
  if (cli.version) return console.log(version)
  const configDir = cli.configDir ?? defaultConfigDir()

  if (cli.command === 'doctor') {
    const sections = await diagnose(configDir)
    console.log(formatSections(sections))
    process.exitCode = healthy(sections) ? 0 : 1
    return
  }

  const config = await loadConfig(configDir)

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
    host: await createHost(config),
    report: reportExit(plane),
  })
  await runLive(
    config,
    plane,
    supervisor,
    { drain: drain.signal, stop: stop.signal },
    config.metricsInterval === undefined
      ? undefined
      : createSampler(config.dataDir),
  )
}

try {
  await main()
} catch (error) {
  if (!(error instanceof AgentError)) throw error
  console.error(`error: ${error.message}`)
  if (error instanceof UsageError) console.error(`\n${usage}`)
  process.exit(error instanceof UsageError ? 2 : 1)
}
