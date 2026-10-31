import type { KnownForgeKind } from 'forges'

// Forges plane can register apps on, named as in `forges`.
export const forgeKinds = ['github'] as const satisfies KnownForgeKind[]

export type ForgeKind = (typeof forgeKinds)[number]

export type ForgeSecrets = Record<string, string>

// Where the browser goes to register the app on the forge. With `POST`, the
// SPA submits `fields` as a form; with `GET`, it navigates to `url`.
export type ForgeSetupRedirect = {
  url: string
  method: 'GET' | 'POST'
  fields: Record<string, string>
}

export type ForgeRegisteredApp = {
  externalId: string
  slug: string
  name: string
  url: string
  installUrl: string | null
  owner: string
  secrets: ForgeSecrets
}

// A CI job waiting for a runner with matching labels.
export type JobQueuedEvent = {
  type: 'job.queued'
  jobId: string
  repository: string
  labels: string[]
}

export type Forge = {
  kind: ForgeKind
  // `owner` is the forge namespace (user, org, group) to register the app
  // under; the forge's default (usually the signed-in account) when omitted.
  setup(input: {
    appId: string
    state: string
    owner?: string
  }): ForgeSetupRedirect
  // Exchanges the `code` the forge redirected back with for the app.
  complete(input: { code: string }): Promise<ForgeRegisteredApp>
  // Authenticates a webhook delivery and extracts the events plane acts on.
  receive(input: {
    headers: Headers
    body: string
    secrets: ForgeSecrets
  }): Promise<JobQueuedEvent[]>
}
