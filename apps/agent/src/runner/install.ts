import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { RunnerInstallError } from './errors'

// A build of actions/runner, as the plane names it.
export type RunnerBuild = {
  version: string
  url: string
  sha256: string
}

const COMPLETE_MARKER = '.manica-complete'

// Downloads, verifies and extracts runner builds into `<dir>/<version>`,
// once each. A build is published by renaming it into place once complete,
// so a crash midway leaves nothing half-installed. Builds are templates:
// runners run from copies of them (see `copyBuild`).
export const createInstaller = (
  dir: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) => {
  const installing = new Map<string, Promise<string>>()

  const install = async (build: RunnerBuild) => {
    const target = join(dir, build.version)
    if (await Bun.file(join(target, COMPLETE_MARKER)).exists()) return target

    await mkdir(dir, { recursive: true })
    const scratch = await mkdtemp(join(dir, `.${build.version}-`))
    const archive = join(scratch, 'runner.tar.gz')
    // The last failed download of this version, kept to look into.
    const failed = join(dir, `${build.version}.failed.tar.gz`)
    try {
      const response = await fetch(build.url).catch((error: unknown) => {
        throw new RunnerInstallError(build.version, String(error))
      })
      if (!response.ok || !response.body) {
        throw new RunnerInstallError(build.version, `HTTP ${response.status}`)
      }
      const hasher = new Bun.CryptoHasher('sha256')
      const writer = Bun.file(archive).writer()
      for await (const chunk of response.body) {
        hasher.update(chunk)
        writer.write(chunk)
      }
      await writer.end()
      const actual = hasher.digest('hex')
      if (actual !== build.sha256) {
        throw new RunnerInstallError(
          build.version,
          `checksum mismatch: expected ${build.sha256}, got ${actual}`,
        )
      }

      const extracted = join(scratch, 'build')
      // Bun.Archive rejects a Bun.file() as input (ReadError), so it gets the
      // bytes. It keeps modes and symlinks and confines entries to `extracted`.
      await new Bun.Archive(await Bun.file(archive).bytes())
        .extract(extracted)
        .catch((error: unknown) => {
          throw new RunnerInstallError(
            build.version,
            `extracting failed: ${String(error)}`,
          )
        })
      await Bun.write(join(extracted, COMPLETE_MARKER), '')
      // Clears what an interrupted install may have left.
      await rm(target, { recursive: true, force: true })
      await rename(extracted, target)
      await rm(failed, { force: true })
      return target
    } catch (error) {
      const reason =
        error instanceof RunnerInstallError ? error.reason : String(error)
      if (!(await Bun.file(archive).exists())) {
        throw new RunnerInstallError(build.version, reason)
      }
      await rename(archive, failed)
      throw new RunnerInstallError(build.version, reason, failed)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  return {
    // The directory of the installed build, installing it first if needed.
    // Concurrent calls for a build share one install.
    ensure(build: RunnerBuild) {
      let pending = installing.get(build.version)
      if (!pending) {
        pending = install(build).finally(() => installing.delete(build.version))
        installing.set(build.version, pending)
      }
      return pending
    },
  }
}

// Copies a build for one runner: a runner writes its identity and
// credentials next to its binaries, so runners can't share one. Copies are
// cheap clones where the filesystem supports them (APFS, btrfs, XFS).
export const copyBuild = async (build: string, target: string) => {
  const clone =
    process.platform === 'darwin'
      ? ['cp', '-cR', build, target]
      : ['cp', '-R', '--reflink=auto', build, target]
  if ((await Bun.spawn(clone, { stderr: 'ignore' }).exited) === 0) return
  await rm(target, { recursive: true, force: true })
  const copy = Bun.spawn(['cp', '-R', build, target], { stderr: 'pipe' })
  if ((await copy.exited) !== 0) {
    throw new Error(`copying ${build} failed: ${await copy.stderr.text()}`)
  }
}
