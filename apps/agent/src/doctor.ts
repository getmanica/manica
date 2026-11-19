import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type Check, fail, ok } from './checks'
import { type Config, loadConfig } from './config'
import { AgentError } from './errors'
import { createPlane } from './plane'
import type { VmBackend } from './vm/backend'
import { BACKENDS, type BackendName } from './vm/backends'

// A group of checks, as printed under one heading. Checks of a section that
// doesn't count (a VM backend the config doesn't use) don't fail doctor.
export type Section = { title: string; checks: Check[]; counts: boolean }

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// Whether the plane is reachable and takes the token. Uses the heartbeat,
// which only marks the agent seen: a poll would tell the plane the agent
// holds no runners, and it would give up on the ones a running agent holds.
const checkPlane = async (config: Config): Promise<Check> => {
  const origin = config.plane.url.origin
  try {
    const { error } = await createPlane(config.plane).agent.heartbeat.post()
    if (!error) return ok(`${origin} accepted the agent token`)
    if (error.status === 401) {
      return fail(
        `${origin} rejected the agent token`,
        'regenerate it in the console and update plane.token (or MANICA_AGENT_TOKEN)',
      )
    }
    const reason =
      error.value instanceof Error
        ? error.value.message
        : `HTTP ${error.status}`
    return fail(`${origin} can't be reached: ${reason}`)
  } catch (error) {
    return fail(`${origin} can't be reached: ${describe(error)}`)
  }
}

const checkPlatform = (): Check =>
  process.platform === 'win32'
    ? fail(`running jobs on ${process.platform} isn't supported yet`)
    : ok(`${process.platform}-${process.arch}`)

const checkDataDir = async (dir: string): Promise<Check> => {
  try {
    await mkdir(dir, { recursive: true })
    const probe = join(dir, `.doctor-${process.pid}`)
    await Bun.write(probe, '')
    await rm(probe)
    return ok(`data directory ${dir} is writable`)
  } catch (error) {
    return fail(`data directory ${dir} isn't writable: ${describe(error)}`)
  }
}

type Options = {
  // The backends to check, by name. Defaults to every one the agent knows.
  backends?: Partial<Record<BackendName, () => VmBackend>>
  checkPlane?: (config: Config) => Promise<Check>
}

// Checks what the agent needs to run jobs, and which VM backends this
// machine can use: everything `manica-agent` would trip on, without taking
// a job.
export const diagnose = async (
  configDir: string,
  { backends = BACKENDS, checkPlane: plane = checkPlane }: Options = {},
): Promise<Section[]> => {
  const sections: Section[] = []
  const path = join(configDir, 'config.toml')
  let config: Config | undefined
  try {
    config = await loadConfig(configDir)
    sections.push({ title: 'Config', checks: [ok(path)], counts: true })
  } catch (error) {
    if (!(error instanceof AgentError)) throw error
    sections.push({
      title: 'Config',
      checks: [fail(error.message)],
      counts: true,
    })
  }

  if (config) {
    sections.push({
      title: 'Plane',
      checks: [await plane(config)],
      counts: true,
    })
  }

  sections.push({
    title: 'This machine',
    checks: [
      checkPlatform(),
      ...(config ? [await checkDataDir(config.dataDir)] : []),
      ok(
        config?.vm
          ? `jobs run in ${config.vm.backend} VMs cloned from ${config.vm.image}`
          : 'jobs run on this machine, as this user ([vm] isn’t set)',
      ),
    ],
    counts: true,
  })

  for (const [name, create] of Object.entries(backends) as [
    BackendName,
    () => VmBackend,
  ][]) {
    const used = config?.vm?.backend === name
    sections.push({
      title: used ? `VM backend: ${name}` : `VM backend: ${name} (not used)`,
      checks: await create().diagnose(used ? config?.vm?.image : undefined),
      counts: used,
    })
  }
  return sections
}

const SYMBOLS = { ok: '✓', warn: '!', fail: '✗' } as const

export const formatSections = (sections: Section[]) =>
  sections
    .map(({ title, checks }) =>
      [
        title,
        ...checks.flatMap(({ status, message, hint }) => [
          `  ${SYMBOLS[status]} ${message}`,
          ...(hint && status !== 'ok' ? [`      ${hint}`] : []),
        ]),
      ].join('\n'),
    )
    .join('\n\n')

// Whether every check that counts passed (warnings pass).
export const healthy = (sections: Section[]) =>
  sections.every(
    ({ checks, counts }) =>
      !counts || checks.every((check) => check.status !== 'fail'),
  )
