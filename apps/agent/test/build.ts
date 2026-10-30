import { chmod, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const tempDir = () => mkdtemp(join(tmpdir(), 'manica-agent-test-'))

// A stand-in for an actions/runner build: a run.sh that records its
// environment and arguments, starts a child (as the real listener does),
// and exits with $EXIT_CODE once that child is done.
export const RUN_SH = `#!/bin/bash
DIR="$( cd -P "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
echo "config=$ACTIONS_RUNNER_INPUT_JITCONFIG args=$*"
sleep "\${SLEEP:-0}" &
echo $! > "$DIR/child.pid"
wait
exit "\${EXIT_CODE:-0}"
`

export const createBuild = async () => {
  const dir = await tempDir()
  await Bun.write(join(dir, 'run.sh'), RUN_SH)
  await chmod(join(dir, 'run.sh'), 0o755)
  return dir
}

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const waitFor = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 5000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting')
    await Bun.sleep(20)
  }
}
