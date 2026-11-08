import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The plane: TanStack Start, served by `src/serve.ts` in production (built
// by vite.node.config.ts) and by Vite in development.
export default defineConfig(({ command, mode }) => {
  // .env, for the server to read its configuration from in development;
  // what the environment already sets wins.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[key] ??= value
  }
  return {
    server: { port: Number(process.env.PORT ?? 3000) },
    resolve: { tsconfigPaths: true },
    // The devtools plugin goes first; it removes them from the build.
    plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
    // The build bundles every dependency into dist/server, so the image
    // needs no node_modules. Development keeps them external: its module
    // runner can't evaluate CommonJS (React) inline.
    ...(command === 'build' && { ssr: { noExternal: true } }),
  }
})
