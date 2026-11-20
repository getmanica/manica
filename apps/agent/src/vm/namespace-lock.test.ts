import { expect, test } from 'bun:test'
import { symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDir } from '../../test/build'
import { VmNamespaceInUseError } from '../errors'
import { claimNamespace } from './namespace-lock'

const SCRIPT = join(import.meta.dir, '../../test/claim-namespace.ts')

// Another agent claiming the namespace: resolves once it said how it went.
const contender = async (
  namespace: string,
  lockDir: string,
  mode: 'hold' | 'orphan' | 'try' = 'hold',
) => {
  const child = Bun.spawn(['bun', SCRIPT, namespace, lockDir, mode], {
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const reader = child.stdout.getReader()
  const { value } = await reader.read()
  reader.releaseLock()
  return { child, said: new TextDecoder().decode(value).trim() }
}

const setup = async () => ({
  namespace: await tempDir(),
  lockDir: await tempDir(),
})

test('another live agent holds it; once it’s gone, however, it’s free', async () => {
  const { namespace, lockDir } = await setup()
  const holder = await contender(namespace, lockDir)
  expect(holder.said).toBe('ok')
  const refused = claimNamespace(namespace, lockDir)
  await expect(refused).rejects.toBeInstanceOf(VmNamespaceInUseError)
  await expect(refused).rejects.toThrow(`pid ${holder.child.pid}`)
  // Killed outright: the kernel releases the lock.
  holder.child.kill('SIGKILL')
  await holder.child.exited
  await claimNamespace(namespace, lockDir)
  // Claiming again from the holder is fine.
  await claimNamespace(namespace, lockDir)
})

test('of agents claiming at once, exactly one gets it', async () => {
  for (let round = 0; round < 5; round++) {
    const { namespace, lockDir } = await setup()
    const contenders = await Promise.all(
      [1, 2, 3].map(() => contender(namespace, lockDir)),
    )
    try {
      expect(contenders.filter((c) => c.said === 'ok')).toHaveLength(1)
    } finally {
      for (const { child } of contenders) child.kill()
    }
  }
})

test('processes an agent started don’t keep its claim', async () => {
  const { namespace, lockDir } = await setup()
  const agent = await contender(namespace, lockDir, 'orphan')
  expect(agent.said).toBe('ok')
  await agent.child.exited
  // Its child still runs, but doesn't hold the lock.
  expect((await contender(namespace, lockDir, 'try')).said).toBe('ok')
})

test('the same directory written differently is the same namespace', async () => {
  const { namespace, lockDir } = await setup()
  const alias = join(await tempDir(), 'lima')
  await symlink(namespace, alias)
  const holder = await contender(namespace, lockDir)
  try {
    for (const same of [`${namespace}/`, `${namespace}/./`, alias]) {
      await expect(claimNamespace(same, lockDir)).rejects.toBeInstanceOf(
        VmNamespaceInUseError,
      )
    }
  } finally {
    holder.child.kill()
  }
})
