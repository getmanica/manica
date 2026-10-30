import { expect, mock, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createBuild, isAlive, tempDir, waitFor } from '../../test/build'
import { createSupervisor } from './supervisor'

const build = { version: '1.0.0', url: 'unused', sha256: 'unused' }

const setup = async (env: Record<string, string> = {}) => {
  const template = await createBuild()
  const runnersDir = await tempDir()
  const lines: string[] = []
  const report = mock(async (_id: string, _exitCode: number | null) => {})
  Object.assign(process.env, env)
  const supervisor = createSupervisor({
    runnersDir,
    installer: { ensure: async () => template },
    report,
    log: (line) => lines.push(line),
  })
  return { supervisor, runnersDir, lines, report }
}

const start = { id: 'r1', name: 'manica-r1', config: 'secret-jit' }

test('runs a runner from its own copy, with its config in the environment', async () => {
  const { supervisor, runnersDir, lines, report } = await setup({
    SLEEP: '0',
    EXIT_CODE: '3',
  })
  supervisor.start(start, build)
  expect(supervisor.held()).toEqual(['r1'])
  await waitFor(() => supervisor.allExited)

  expect(lines).toContain('[manica-r1] config=secret-jit args=')
  await supervisor.reportExited()
  expect(report).toHaveBeenCalledWith('r1', 3)
  expect(supervisor.idle).toBe(true)
  // Its copy is gone.
  expect(await readdir(runnersDir)).toEqual([])
})

test('stops a runner’s whole process tree', async () => {
  const { supervisor, runnersDir } = await setup({ SLEEP: '30' })
  supervisor.start(start, build)
  const childPid = join(runnersDir, 'r1', 'child.pid')
  await waitFor(() => Bun.file(childPid).exists())
  const pid = Number(await Bun.file(childPid).text())
  expect(isAlive(pid)).toBe(true)

  await supervisor.stop('r1')
  await waitFor(() => supervisor.allExited)
  await waitFor(() => !isAlive(pid))
})

test('keeps reporting an exit until the plane hears it', async () => {
  const { supervisor, report } = await setup({ SLEEP: '0', EXIT_CODE: '0' })
  report.mockImplementationOnce(async () => {
    throw new Error('plane down')
  })
  supervisor.start(start, build)
  await waitFor(() => supervisor.allExited)
  await supervisor.reportExited()
  expect(supervisor.held()).toEqual(['r1'])
  await supervisor.reportExited()
  expect(supervisor.idle).toBe(true)
})

test('reports a runner that failed to start as exited without a code', async () => {
  const runnersDir = await tempDir()
  const report = mock(async (_id: string, _exitCode: number | null) => {})
  const supervisor = createSupervisor({
    runnersDir,
    installer: {
      ensure: async () => {
        throw new Error('download failed')
      },
    },
    report,
    log: () => {},
  })
  supervisor.start(start, build)
  await waitFor(() => supervisor.allExited)
  await supervisor.reportExited()
  expect(report).toHaveBeenCalledWith('r1', null)
})

test('clears runners a previous agent left running', async () => {
  const { supervisor, runnersDir } = await setup({ SLEEP: '30' })
  supervisor.start(start, build)
  const childPid = join(runnersDir, 'r1', 'child.pid')
  await waitFor(() => Bun.file(childPid).exists())
  const pid = Number(await Bun.file(childPid).text())

  // A new agent, after this one died without stopping it.
  await createSupervisor({
    runnersDir,
    installer: { ensure: async () => '' },
    report: async () => {},
    log: () => {},
  }).clearStale()
  await waitFor(() => !isAlive(pid))
  expect(await readdir(runnersDir)).toEqual([])
})
