import { treaty } from '@elysia/eden'
import type { App } from '../../app'

export const api = treaty<App>(window.location.origin).api

// The message to show for a failed request: the API's typed errors carry a
// human-readable `detail`.
export const errorDetail = ({ value }: { value: unknown }) =>
  (value as { detail?: string } | null)?.detail ?? 'Something went wrong'
