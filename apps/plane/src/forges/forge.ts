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

export const jobStatuses = ['queued', 'in_progress', 'completed'] as const
export type JobStatus = (typeof jobStatuses)[number]

// What the forge says about a CI job: it's waiting for a runner with
// matching labels, a runner picked it up, or it's done. Deliveries can come
// late, twice or out of order. `runner*` are set once a runner picked it
// up, `conclusion` once it completed.
export type JobEvent = {
  type: 'job'
  status: JobStatus
  externalId: string
  runId: string
  installationId: string
  repository: string
  name: string
  url: string
  labels: string[]
  externalRunnerId: string | null
  runnerName: string | null
  conclusion: string | null
  queuedAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

// An app registered on the forge, to act as. `externalId` is the forge's id
// for it.
export type ForgeAppContext = {
  externalId: string
  secrets: ForgeSecrets
}

// Where a runner is registered: on one repository, through one installation
// of the app.
export type RunnerScope = {
  app: ForgeAppContext
  installationId: string
  repository: string
}

// A registered just-in-time runner. `config` is the credential the runner
// starts with: it's handed to the agent once and never stored.
export type CreatedRunner = {
  externalRunnerId: string
  config: string
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
  }): Promise<JobEvent[]>
  // Registers a one-shot runner that picks up a job asking for `labels`.
  // Rejects with `RunnerNameTakenError` if `name` is already registered.
  createRunner(
    input: RunnerScope & { name: string; labels: string[] },
  ): Promise<CreatedRunner>
  // The id of the runner registered as `name`, if there is one: for when
  // `createRunner`'s outcome is unknown.
  findRunner(input: RunnerScope & { name: string }): Promise<string | undefined>
  // Unregisters a runner. A runner that's gone already counts as deleted;
  // one running a job can't be deleted yet.
  deleteRunner(
    input: RunnerScope & { externalRunnerId: string },
  ): Promise<'deleted' | 'busy'>
  // What the forge says about a job now, or undefined if it's gone (or the
  // app lost access to it).
  getJob(
    input: RunnerScope & { externalId: string },
  ): Promise<JobEvent | undefined>
  // Asks the forge to send again the job deliveries since `since` that the
  // plane failed to receive. Returns how many it asked for.
  redeliverFailed(input: { app: ForgeAppContext; since: Date }): Promise<number>
}
