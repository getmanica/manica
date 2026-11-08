import { defineConfig } from 'vite'

// The plane's Node entry points, bundled with their dependencies: dist/
// serve.js, the process (which imports the Start build next to it at
// runtime), and dist/migrate.js, the pre-deploy step.
export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: { serve: 'src/serve.ts', migrate: 'src/migrate.ts' },
      output: { entryFileNames: '[name].js' },
    },
  },
})
