// Cross-compiles the agent for the given platforms into dist/release, one
// executable per platform named after its release asset.
//
//   bun scripts/compile.ts [--os darwin|linux]
//
// Without --os it builds every platform in platforms.ts.
import { parseArgs } from 'node:util'
import { binaryName, platforms } from './platforms'

const { values } = parseArgs({ options: { os: { type: 'string' } } })

const root = new URL('..', import.meta.url).pathname
const selected = platforms.filter((p) => !values.os || p.os === values.os)
if (selected.length === 0) throw new Error(`no platform for os ${values.os}`)

for (const platform of selected) {
  const outfile = `${root}dist/release/${binaryName(platform)}`
  await Bun.build({
    entrypoints: [`${root}src/index.ts`],
    compile: { target: platform.target, outfile, autoloadBunfig: false },
    minify: true,
  })
  console.log(`built ${outfile} (${platform.target})`)
}
