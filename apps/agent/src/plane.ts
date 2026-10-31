import { treaty } from '@elysia/eden'
import type { App } from 'plane'
import type { Config } from './config'

export type Plane = ReturnType<typeof createPlane>

// A typed client for the plane's API, authenticated as the agent.
export const createPlane = ({ url, token }: Config['plane']) =>
  treaty<App>(url.origin, {
    headers: { authorization: `Bearer ${token}` },
  }).api
