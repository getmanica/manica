import { expect, test } from 'bun:test'
import { runExclusive } from './scheduler'

test('runExclusive runs one task of a name at a time', async () => {
  let release = () => {}
  const first = runExclusive(
    'test-task',
    () => new Promise<void>((resolve) => (release = resolve)),
  )
  // Let the first run take the lock.
  await Bun.sleep(50)
  expect(await runExclusive('test-task', async () => {})).toBe(false)
  expect(await runExclusive('other-task', async () => {})).toBe(true)
  release()
  expect(await first).toBe(true)
  expect(await runExclusive('test-task', async () => {})).toBe(true)
})
