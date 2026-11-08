import { treaty } from '@elysia/eden'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { App } from '../../api/app'

// The API, typed from its Elysia app. In the browser, over HTTP; while
// rendering on the server (loaders), in-process, as the viewer: with the
// cookies of the request being rendered.
const createApi = createIsomorphicFn()
  .server(
    () =>
      treaty<App>('http://plane', {
        fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const { app } = await import('../../api/app')
          return app.handle(new Request(input, init))
        }) as typeof fetch,
        headers: () => ({ cookie: getRequestHeaders().get('cookie') ?? '' }),
      }).api,
  )
  .client(() => treaty<App>(window.location.origin).api)

export const api = createApi()

// The message to show for a failed request: the API's typed errors carry a
// human-readable `detail`.
export const errorDetail = ({ value }: { value: unknown }) =>
  (value as { detail?: string } | null)?.detail ?? 'Something went wrong'
