import { TanStackDevtools } from '@tanstack/react-devtools'
import { pacerDevtoolsPlugin } from '@tanstack/react-pacer-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'

// TanStack's devtools, in development only: `@tanstack/devtools-vite`
// strips them from the build.
export function Devtools() {
  return (
    <TanStackDevtools
      config={{ position: 'bottom-right' }}
      plugins={[
        { name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> },
        { name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> },
        pacerDevtoolsPlugin(),
      ]}
    />
  )
}
