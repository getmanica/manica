// Stages the npm packages from the executables in dist/release (see
// compile.ts) into dist/npm, and prints their directories in the order they
// have to be published: the platform packages before @manica/agent, which
// depends on them.
//
//   bun scripts/npm.ts
//
// @manica/agent lists every platform package as an optional dependency;
// their `os` and `cpu` fields make package managers install only the one
// matching the machine, and its launcher runs that package's executable.
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises'
import pkg from '../package.json'
import { binaryName, type Platform, platformName, platforms } from './platforms'

const root = new URL('..', import.meta.url).pathname
const out = `${root}dist/npm`
const { version } = pkg

const common = {
  version,
  homepage: 'https://github.com/getmanica/manica',
  repository: {
    type: 'git',
    url: 'git+https://github.com/getmanica/manica.git',
    directory: 'apps/agent',
  }
}

const writeJson = (path: string, value: unknown) =>
  Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)

const platformPackage = (p: Platform) => `@manica/agent-${platformName(p)}`

await rm(out, { recursive: true, force: true })
const dirs: string[] = []

for (const platform of platforms) {
  const dir = `${out}/agent-${platformName(platform)}`
  const binary = `${dir}/bin/manica-agent`
  await mkdir(`${dir}/bin`, { recursive: true })
  await copyFile(`${root}dist/release/${binaryName(platform)}`, binary)
  // npm keeps the executable bit in the tarball.
  await chmod(binary, 0o755)
  await writeJson(`${dir}/package.json`, {
    name: platformPackage(platform),
    ...common,
    description: `The Manica agent for ${platformName(platform)}`,
    os: [platform.os],
    cpu: [platform.cpu],
    // The Linux builds link against glibc.
    ...(platform.os === 'linux' && { libc: ['glibc'] }),
    files: ['bin'],
    preferUnplugged: true,
  })
  dirs.push(dir)
}

const dir = `${out}/agent`
await mkdir(`${dir}/bin`, { recursive: true })
await copyFile(`${root}npm/manica-agent.js`, `${dir}/bin/manica-agent.js`)
await chmod(`${dir}/bin/manica-agent.js`, 0o755)
await writeJson(`${dir}/package.json`, {
  name: '@manica/agent',
  ...common,
  description: 'Run your own GitHub Actions runners on your own machines',
  type: 'module',
  bin: { 'manica-agent': 'bin/manica-agent.js' },
  files: ['bin'],
  optionalDependencies: Object.fromEntries(
    platforms.map((p) => [platformPackage(p), version]),
  ),
})
dirs.push(dir)

console.log(dirs.join('\n'))
