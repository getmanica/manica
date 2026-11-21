// Cross-compiles the agent for the given platforms into dist/release, one
// executable per platform named after its release asset.
//
//   bun scripts/compile.ts [--os darwin|linux]
//
// Without --os it builds every platform in platforms.ts. macOS builds use
// the Apple toolchain (so they build on a Mac), Linux ones cargo-zigbuild
// (on any machine); mise.toml has the Rust targets and both tools.
import { copyFile, mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { binaryName, platforms } from './platforms'

const { values } = parseArgs({ options: { os: { type: 'string' } } })

const root = new URL('..', import.meta.url).pathname
const selected = platforms.filter((p) => !values.os || p.os === values.os)
if (selected.length === 0) throw new Error(`no platform for os ${values.os}`)

await mkdir(`${root}dist/release`, { recursive: true })
for (const platform of selected) {
  const build = platform.os === 'linux' ? 'zigbuild' : 'build'
  const cargo = Bun.spawn(
    ['cargo', build, '--release', '--locked', '--target', platform.target],
    { cwd: root, stdout: 'inherit', stderr: 'inherit' },
  )
  if ((await cargo.exited) !== 0) {
    throw new Error(`building for ${platform.target} failed`)
  }
  const outfile = `${root}dist/release/${binaryName(platform)}`
  await copyFile(
    `${root}target/${platform.target}/release/manica-agent`,
    outfile,
  )
  console.log(`built ${outfile} (${platform.target})`)
}
