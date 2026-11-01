import { db } from './db'

// Runs `task` unless another plane instance (or an earlier, slower run on
// this one) is running the task named `name`, holding a Postgres advisory
// lock meanwhile. Session locks belong to a connection, so it's held on one
// reserved for the run. Returns whether the task ran.
export const runExclusive = async (name: string, task: () => Promise<void>) => {
  const connection = await db.$client.reserve()
  try {
    const [row] = await connection<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${name})) as locked`
    if (!row?.locked) return false
    try {
      await task()
    } finally {
      await connection`select pg_advisory_unlock(hashtext(${name}))`
    }
    return true
  } finally {
    connection.release()
  }
}

// Runs `task` now and every `intervalMs`, one instance at a time; failures
// are logged and retried next time. Returns a function that stops it.
export const every = (
  name: string,
  intervalMs: number,
  task: () => Promise<void>,
) => {
  const run = () =>
    runExclusive(name, task).catch((error: unknown) => {
      console.error(`${name} failed:`, error)
    })
  void run()
  const timer = setInterval(() => void run(), intervalMs)
  return () => clearInterval(timer)
}
