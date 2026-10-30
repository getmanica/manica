// Compiles the plane, console included, into a single executable at
// dist/plane. The console is bundled here instead of at startup, so the
// Tailwind plugin bunfig.toml gives the dev server is passed in explicitly.
//
//   bun run build [--target bun-linux-arm64]
//
// Without --target it builds for the host. The executable reads its
// migrations from MIGRATIONS_DIR (see api/platform/env.ts).
import { parseArgs } from 'node:util'
import tailwind from 'bun-plugin-tailwind'

const { values } = parseArgs({
  options: { target: { type: 'string' } },
})

const root = new URL('..', import.meta.url).pathname

await Bun.build({
  entrypoints: [`${root}src/main.ts`],
  compile: {
    ...(values.target && {
      target: values.target as Bun.Build.CompileTarget,
    }),
    outfile: `${root}dist/plane`,
    // bunfig.toml only configures dev and tests.
    autoloadBunfig: false,
  },
  plugins: [tailwind],
  minify: true,
  sourcemap: 'linked',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})

console.log(`built dist/plane${values.target ? ` (${values.target})` : ''}`)
