import { QueryClient } from '@tanstack/react-query'
import { errorDetail } from '@/lib/api'

// One per router: per request on the server, so viewers never share a
// cache, and one for the page's life in the browser.
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Pages poll what moves on its own; the rest is fresh enough for a
        // bit.
        staleTime: 5_000,
        retry: 1,
      },
    },
  })

// A failed request, carrying the API's message.
export class RequestError extends Error {
  readonly status: number

  constructor(error: { status: number; value: unknown }) {
    super(errorDetail(error))
    this.name = 'RequestError'
    this.status = error.status
  }
}

// Eden resolves with `{ data, error }`; queries want data or a throw.
export const unwrap = <Data>({
  data,
  error,
}: {
  data: Data | null
  error: { status: number; value: unknown } | null
}): Data => {
  if (error) throw new RequestError(error)
  return data as Data
}
